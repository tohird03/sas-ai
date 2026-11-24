const models = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
];

for (const model of models) {
  const started = Date.now();
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY,
        },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Salom, bitta so‘z bilan javob ber.' }] }],
        }),
      },
    );
    const body = await res.text();
    console.log(`${model} -> ${res.status} (${Date.now() - started}ms)`);
    console.log(body.slice(0, 200).replace(/\s+/g, ' '), '\n');
  } catch (e) {
    console.log(`${model} -> XATO: ${e.name} (${Date.now() - started}ms)\n`);
  }
}
