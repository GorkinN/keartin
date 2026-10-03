import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/field-hint";
import { Input } from "@/components/ui/input";

type Point = { x: number; y: number };
type Stroke = { kind: "circle"; x: number; y: number; r: number } | { kind: "brush"; points: Point[] };
type Item = { id: string; file: File; url: string; strokes: Stroke[] };
type Tool = "circle" | "brush";

export type ReferenceBoardHandle = {
  files: () => Promise<File[]>;
  count: () => number;
};

export const ReferenceBoard = forwardRef<ReferenceBoardHandle, { max: number }>(function ReferenceBoard({ max }, ref) {
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("circle");
  const [draft, setDraft] = useState<Stroke | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const current = items.find((item) => item.id === selected) ?? null;

  useImperativeHandle(ref, () => ({
    count: () => items.length,
    files: async () => {
      const files: File[] = [];
      for (const item of items) {
        files.push(item.strokes.length === 0 ? item.file : await bake(item));
      }
      return files;
    },
  }));

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const room = Math.max(0, max - items.length);
    const next = [...list].slice(0, room).map((file) => ({
      id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
      file,
      url: URL.createObjectURL(file),
      strokes: [] as Stroke[],
    }));
    setItems((prev) => [...prev, ...next]);
    if (!selected && next[0]) setSelected(next[0].id);
  };

  const remove = (id: string) => {
    setItems((prev) => {
      const found = prev.find((item) => item.id === id);
      if (found) URL.revokeObjectURL(found.url);
      return prev.filter((item) => item.id !== id);
    });
    if (selected === id) setSelected(null);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !current) return;
    paint(canvas, draft ? [...current.strokes, draft] : current.strokes);
  }, [current, draft]);

  const pointOf = (event: ReactPointerEvent<HTMLCanvasElement>): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  };

  const commit = (stroke: Stroke | null) => {
    if (!stroke || !current) return;
    if (stroke.kind === "brush" && stroke.points.length < 2) return;
    if (stroke.kind === "circle" && stroke.r < 0.01) return;
    setItems((prev) => prev.map((item) => (item.id === current.id ? { ...item, strokes: [...item.strokes, stroke] } : item)));
  };

  return (
    <div className="space-y-2">
      <FieldLabel htmlFor="image-references" hint="До 10 изображений. Круг и кисть рисуются на выбранном референсе и уходят в модель вместе с ним.">
        Референсы
      </FieldLabel>
      <Input
        id="image-references"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={(event) => {
          addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <p className="text-sm text-muted-foreground">{items.length} из {max}</p>
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <button key={item.id} type="button" className="space-y-1 text-left" onClick={() => setSelected(item.id)}>
              <img src={item.url} alt="" className={`h-16 w-16 rounded-md object-cover ${item.id === selected ? "ring-2 ring-ring" : ""}`} />
            </button>
          ))}
        </div>
      ) : null}
      {current ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={tool === "circle" ? "default" : "outline"} onClick={() => setTool("circle")}>
              Круг
            </Button>
            <Button type="button" size="sm" variant={tool === "brush" ? "default" : "outline"} onClick={() => setTool("brush")}>
              Кисть
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setItems((prev) => prev.map((item) => (item.id === current.id ? { ...item, strokes: [] } : item)))}>
              Стереть пометки
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => remove(current.id)}>
              Убрать
            </Button>
          </div>
          <div className="relative max-w-md">
            <img src={current.url} alt="" className="w-full rounded-md" />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 h-full w-full cursor-crosshair"
              onPointerDown={(event) => {
                const point = pointOf(event);
                if (!point) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                setDraft(tool === "circle" ? { kind: "circle", ...point, r: 0 } : { kind: "brush", points: [point] });
              }}
              onPointerMove={(event) => {
                const point = pointOf(event);
                if (!point || !draft) return;
                const next: Stroke =
                  draft.kind === "circle"
                    ? { ...draft, r: radiusOf(draft, point, event.currentTarget) }
                    : { kind: "brush", points: [...draft.points, point] };
                setDraft(next);
              }}
              onPointerUp={() => {
                commit(draft);
                setDraft(null);
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
});

function radiusOf(center: { x: number; y: number }, point: Point, canvas: HTMLCanvasElement): number {
  const box = canvas.getBoundingClientRect();
  const dx = (point.x - center.x) * box.width;
  const dy = (point.y - center.y) * box.height;
  return box.width === 0 ? 0 : Math.hypot(dx, dy) / box.width;
}

function paint(canvas: HTMLCanvasElement, strokes: Stroke[]) {
  const box = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(box.width));
  canvas.height = Math.max(1, Math.round(box.height));
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#e11d48";
  context.lineWidth = Math.max(2, canvas.width * 0.012);
  for (const stroke of strokes) {
    context.beginPath();
    if (stroke.kind === "circle") {
      context.ellipse(stroke.x * canvas.width, stroke.y * canvas.height, stroke.r * canvas.width, stroke.r * canvas.width, 0, 0, Math.PI * 2);
    } else {
      stroke.points.forEach((point, index) => {
        const x = point.x * canvas.width;
        const y = point.y * canvas.height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
    }
    context.stroke();
  }
}

async function bake(item: Item): Promise<File> {
  const image = await loadImage(item.url);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) return item.file;
  context.drawImage(image, 0, 0);
  context.strokeStyle = "#e11d48";
  context.lineWidth = Math.max(4, canvas.width * 0.012);
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of item.strokes) {
    context.beginPath();
    if (stroke.kind === "circle") {
      context.ellipse(stroke.x * canvas.width, stroke.y * canvas.height, stroke.r * canvas.width, stroke.r * canvas.width, 0, 0, Math.PI * 2);
      context.stroke();
    } else {
      stroke.points.forEach((point, index) => {
        const x = point.x * canvas.width;
        const y = point.y * canvas.height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    }
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return item.file;
  return new File([blob], "reference.png", { type: "image/png" });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("reference"));
    image.src = url;
  });
}
