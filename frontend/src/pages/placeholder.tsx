import { Card } from "@/components/ui/card";

export function PlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card title={title}>
      <p>{description}</p>
      <p className="mt-2">Экран-заглушка этапа 0. Генерации здесь нет.</p>
    </Card>
  );
}
