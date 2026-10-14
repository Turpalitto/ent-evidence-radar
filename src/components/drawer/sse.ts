/**
 * Чтение потока `/api/ai` (text/event-stream): строки `data: {"ok":true,"delta":"…"}`.
 * Фрагменты сети режут строки произвольно — буферизуем до перевода строки (хвост без `\n`
 * обрабатывается по окончании потока); строки без `data:` (комментарии, пустые) и невалидный JSON
 * пропускаются; `{ok:false,error}` прерывает поток ошибкой.
 */
export async function consumeSseDeltas(
  body: ReadableStream<Uint8Array>,
  onDelta: (delta: string) => void,
  fallbackError: string,
): Promise<void> {
  const handleLine = (raw: string) => {
    const line = raw.trim();
    if (!line.startsWith("data:")) return;
    let j: { ok?: boolean; delta?: string; error?: string };
    try {
      j = JSON.parse(line.slice(5).trim()) as typeof j;
    } catch {
      return;
    }
    if (!j.ok || j.error) throw new Error(j.error ?? fallbackError);
    if (j.delta) onDelta(j.delta);
  };

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  let done = false;
  while (!done) {
    const { value, done: d } = await reader.read();
    done = d;
    acc += decoder.decode(value, { stream: !done });
    let nl: number;
    while ((nl = acc.indexOf("\n")) !== -1) {
      handleLine(acc.slice(0, nl));
      acc = acc.slice(nl + 1);
    }
  }
  if (acc.trim()) handleLine(acc);
}
