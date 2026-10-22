import "dotenv/config";
const baseURL = process.env.OPENAI_BASE_URL;
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL;
if (!baseURL || !apiKey || !model) throw new Error("model endpoint configuration incomplete");
const authorization = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
const modelResponse = await fetch(new URL("models", `${baseURL.replace(/\/$/, "")}/`), { headers: authorization, signal: AbortSignal.timeout(15_000) });
const models = await modelResponse.json().catch(() => null);
const names = Array.isArray(models?.data) ? models.data.map(item => item.id).filter(id => typeof id === "string") : [];
const chatResponse = await fetch(new URL("chat/completions", `${baseURL.replace(/\/$/, "")}/`), {
  method: "POST", headers: authorization, signal: AbortSignal.timeout(30_000),
  body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with OK." }], max_tokens: 4, temperature: 0 })
});
const chatBody = await chatResponse.json().catch(() => null);
console.log(JSON.stringify({
  modelList: { status: modelResponse.status, includesConfiguredModel: names.includes(model), count: names.length },
  completion: {
    status: chatResponse.status,
    ok: chatResponse.ok,
    errorType: typeof chatBody?.error?.type === "string" ? chatBody.error.type : null,
    errorCode: typeof chatBody?.error?.code === "string" ? chatBody.error.code : null,
    errorMessage: typeof chatBody?.error?.message === "string" ? chatBody.error.message.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 240) : null,
    hasChoice: Array.isArray(chatBody?.choices) && chatBody.choices.length > 0,
    responseContentLength: typeof chatBody?.choices?.[0]?.message?.content === "string" ? chatBody.choices[0].message.content.length : null,
    usage: chatBody?.usage ?? null
  }
}));
