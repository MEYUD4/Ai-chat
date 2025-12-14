export const config = {
  runtime: "edge"
};

// RATE LIMIT
const rateLimitMap = new Map();

// MEMORY
const memoryMap = new Map();

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const ip =
    req.headers.get("x-forwarded-for") ||
    req.headers.get("x-real-ip") ||
    "unknown";

  const now = Date.now();

  // RATE LIMIT: 1 request / 5 detik
  if (rateLimitMap.has(ip) && now - rateLimitMap.get(ip) < 5000) {
    return new Response("Rate limit exceeded", { status: 429 });
  }
  rateLimitMap.set(ip, now);

  const { message } = await req.json();

  // AMBIL MEMORY (maks 6 pesan)
  let history = memoryMap.get(ip) || [];
  history.push({ role: "user", content: message });
  history = history.slice(-6);

  const response = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        stream: true,
        messages: [
          {
            role: "system",
            content:
              "Kamu adalah AI bernama VENDETTA V - III. Kamu dingin, cyber, strategis, dan mengingat konteks percakapan."
          },
          ...history
        ]
      })
    }
  );

  // SIMPAN BALASAN AI KE MEMORY
  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullReply = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.replace("data: ", "");
            if (data === "[DONE]") break;

            try {
              const json = JSON.parse(data);
              const token = json.choices[0].delta.content || "";
              fullReply += token;
              controller.enqueue(value);
            } catch {}
          }
        }
      }

      history.push({ role: "assistant", content: fullReply });
      memoryMap.set(ip, history);
      controller.close();
    }
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" }
  });
}