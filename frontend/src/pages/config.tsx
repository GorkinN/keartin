import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "@/api/client";
import type { AppConfig } from "@/api/types";
import { ErrorText } from "@/components/error-text";
import { Card } from "@/components/ui/card";

export function ConfigPage() {
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => api<AppConfig>("/config"),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Конфигурация</h1>
        <p className="text-sm text-muted-foreground">Модели, с которыми сейчас работает приложение.</p>
      </div>
      <ErrorText message={config.isError ? errorMessage(config.error) : null} />
      {config.isPending ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
      {config.data ? <ConfigView config={config.data} /> : null}
    </div>
  );
}

function ConfigView({ config }: { config: AppConfig }) {
  return (
    <div className="space-y-3">
      <Card title="Текст">
        <About>Локальная модель Ollama пишет пост и английский промпт картинки.</About>
        <Rows
          rows={[
            ["Модель", config.llm.model],
            ["Контекст", String(config.llm.num_ctx)],
            ["Держать в памяти", config.llm.keep_alive],
            ["Ollama", config.llm.host],
          ]}
        />
      </Card>
      <Card title="Эмбеддинги">
        <About>Векторный поиск по книгам, на CPU.</About>
        <Rows rows={[["Модель", config.embed.model]]} />
      </Card>
      <Card title="Flux">
        <About>Текст в картинку до 1024, без референсов.</About>
        <Rows
          rows={[
            ["Модель", config.flux.model],
            ["Квантование", config.flux.quant],
            ["Путь к весам", config.flux.path.trim() || "кэш Hugging Face"],
          ]}
        />
      </Card>
      <Card title="Qwen-Image-2.1">
        <About>Текст в картинку и правка по референсам (до 10), круги, маска и прозрачный фон; считается в отдельном окружении.</About>
        <Rows
          rows={[
            ["Модель", config.qwen.model],
            [
              "Веса GGUF",
              (config.qwen.ggufs ?? []).map((item) => item.label).join(", ") ||
                ((config.qwen.path ?? "").trim() || "нет, transformer из кэша Hugging Face"),
            ],
            ["Интерпретатор", config.qwen.python_ready ? "найден" : "не найден"],
          ]}
        />
      </Card>
      <Card title="Распознавание сканов">
        <About>Страницы PDF без текстового слоя.</About>
        <Rows
          rows={[
            ["Модель", config.ocr.model],
            ["DPI", String(config.ocr.dpi)],
            ["Патчи", String(config.ocr.max_patches)],
            ["Максимум токенов", String(config.ocr.max_new_tokens)],
          ]}
        />
      </Card>
    </div>
  );
}

function About({ children }: { children: string }) {
  return <p className="mb-3 text-sm text-muted-foreground">{children}</p>;
}

function Rows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="space-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[10.5rem_minmax(0,1fr)] gap-3 text-sm">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-all font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
