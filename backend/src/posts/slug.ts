const MAP: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

export function slugifyTopic(topic: string): string {
  let out = "";
  for (const ch of topic.trim().toLowerCase()) {
    if (MAP[ch] !== undefined) out += MAP[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else out += "-";
  }
  out = out.replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!out) return "post";
  return out.slice(0, 40).replace(/-$/g, "") || "post";
}

export function localDateStamp(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function nextStoragePrefix(
  topic: string,
  exists: (storagePrefix: string) => Promise<boolean>,
  date = new Date(),
): Promise<{ slug: string; storagePrefix: string }> {
  const stamp = localDateStamp(date);
  const base = slugifyTopic(topic);
  for (let n = 1; n < 1000; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const storagePrefix = `posts/${stamp}_${slug}`;
    if (!(await exists(storagePrefix))) return { slug, storagePrefix };
  }
  throw new Error("не удалось подобрать имя папки");
}
