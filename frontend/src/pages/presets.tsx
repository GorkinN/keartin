import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/api/client";
import type { Preset } from "@/api/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorText } from "@/components/error-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Draft = {
  name: string;
  description: string;
  examples: string[];
};

type Editor =
  | { mode: "create" }
  | { mode: "edit"; id: string }
  | null;

const emptyDraft = (): Draft => ({ name: "", description: "", examples: [""] });

export function PresetsPage() {
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<Editor>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Preset | null>(null);
  const presets = useQuery({
    queryKey: ["presets"],
    queryFn: () => api<Preset[]>("/presets"),
  });

  const save = useMutation({
    mutationFn: async () => {
      const name = draft.name.trim();
      const description = draft.description.trim();
      if (!name) throw new Error("Нужно имя пресета");
      if (description.length < 10) throw new Error("описание пресета короче 10 символов");
      const payload = {
        name,
        description,
        examples: draft.examples.map((item) => item.trim()).filter(Boolean),
      };
      if (editor?.mode === "edit") {
        return api<Preset>(`/presets/${editor.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      }
      return api<Preset>("/presets", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: async () => {
      setEditor(null);
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ["presets"] });
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/presets/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["presets"] });
    },
  });

  const openCreate = () => {
    setDraft(emptyDraft());
    setFormError(null);
    setEditor({ mode: "create" });
  };

  const openEdit = (preset: Preset) => {
    setDraft({
      name: preset.name,
      description: preset.description,
      examples: preset.examples.length > 0 ? [...preset.examples] : [""],
    });
    setFormError(null);
    setEditor({ mode: "edit", id: preset.id });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Пресеты</h1>
        <Button type="button" onClick={openCreate}>
          Новый пресет
        </Button>
      </div>
      <ErrorText message={presets.isError ? errorMessage(presets.error) : null} />
      {presets.isPending ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
      {presets.data && presets.data.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">Пресетов пока нет.</p>
        </Card>
      ) : null}
      <div className="space-y-3">
        {presets.data?.map((preset) => (
          <Card key={preset.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="font-medium">{preset.name}</p>
                {preset.description ? <p className="text-sm text-muted-foreground">{preset.description}</p> : null}
                {preset.examples.length > 0 ? (
                  <p className="text-sm text-muted-foreground">Примеров: {preset.examples.length}</p>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => openEdit(preset)}>
                  Изменить
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setDeleteTarget(preset)}>
                  Удалить
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editor?.mode === "edit" ? "Изменить пресет" : "Новый пресет"}</DialogTitle>
            <DialogDescription>Имя, описание стиля и до пяти примеров.</DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="preset-name">Имя</Label>
              <Input
                id="preset-name"
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="preset-description">Описание</Label>
              <Textarea
                id="preset-description"
                value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              />
            </div>
            {draft.examples.map((example, index) => (
              <div key={index} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`example-${index}`}>Пример {index + 1}</Label>
                  {draft.examples.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          examples: current.examples.filter((_, item) => item !== index),
                        }))
                      }
                    >
                      Убрать
                    </Button>
                  ) : null}
                </div>
                <Textarea
                  id={`example-${index}`}
                  value={example}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      examples: current.examples.map((item, itemIndex) =>
                        itemIndex === index ? event.target.value : item,
                      ),
                    }))
                  }
                />
              </div>
            ))}
            {draft.examples.length < 5 ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setDraft((current) => ({ ...current, examples: [...current.examples, ""] }))}
              >
                Добавить пример
              </Button>
            ) : null}
            <ErrorText message={formError} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditor(null)}>
              Отмена
            </Button>
            <Button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending || !draft.name.trim() || draft.description.trim().length < 10}
            >
              {save.isPending ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Удалить пресет?"
        description={deleteTarget ? `«${deleteTarget.name}» будет удалён. У постов ссылка на него обнулится.` : ""}
        confirmLabel="Удалить"
        pending={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
