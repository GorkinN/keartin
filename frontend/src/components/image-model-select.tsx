import type { ImageModelId } from "@/api/image-model";
import type { QwenGguf } from "@/api/types";
import { FieldLabel } from "@/components/field-hint";
import { Select, SelectItem } from "@/components/ui/select";

export function ImageModelSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: ImageModelId;
  onChange: (value: ImageModelId) => void;
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={id} hint="Flux рисует по тексту. Qwen-Image-2.1 ещё принимает референсы, пометки и прозрачный фон.">
        Модель
      </FieldLabel>
      <Select id={id} value={value} onValueChange={(next) => onChange(next as ImageModelId)}>
        <SelectItem value="flux">Flux</SelectItem>
        <SelectItem value="qwen">Qwen-Image-2.1</SelectItem>
      </Select>
    </div>
  );
}

export function QwenGgufSelect({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: string;
  options: QwenGguf[];
  onChange: (value: string) => void;
}) {
  if (options.length === 0) return null;
  const selected = options.some((item) => item.id === value) ? value : options[0].id;
  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={id} hint="Какой файл transformer использовать. Текстовый энкодер и VAE общие.">
        Веса Qwen
      </FieldLabel>
      <Select id={id} value={selected} onValueChange={onChange} disabled={options.length < 2}>
        {options.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.label}
          </SelectItem>
        ))}
      </Select>
    </div>
  );
}
