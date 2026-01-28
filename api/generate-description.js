import OpenAI from "openai";

let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const withTimeout = (promise, timeoutMs) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);

const stripCodeFences = (s) =>
  (s || "").replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim();

export default async function handler(req, res) {
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({ error: "Request timeout" });
    }
  }, 50000);

  try {
    if (req.method !== "POST") {
      clearTimeout(timeout);
      return res.status(405).json({ error: "Method not allowed" });
    }

    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body);
    if (!body) {
      clearTimeout(timeout);
      return res.status(400).json({ error: "Request body is required" });
    }

    const authHeader = req.headers["authorization"] || "";
    const expectedToken = process.env.MECHANIC_BEARER_TOKEN;
    if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
      clearTimeout(timeout);
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!process.env.OPENAI_API_KEY || !openai) {
      clearTimeout(timeout);
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    const { product, structured } = body;
    if (!product?.id || !product?.title) {
      clearTimeout(timeout);
      return res.status(400).json({ error: "Missing required product fields" });
    }

    const editorNote =
      structured?.editor_note ||
      product?.editor_note ||
      "";

    /**
     * PROMPT
     * This is where behaviour is now correctly enforced.
     */
    const prompt = [
      "You are writing catalogue-style product descriptions for a luxury resale store.",
      "",
      "AUDIENCE:",
      "- Highly informed buyers who already know the brand, style, size, and materials.",
      "- Do NOT explain what the product is.",
      "",
      "PRIMARY PURPOSE:",
      "- SEO performance",
      "- Google Merchant, Meta, Shopify Collective feeds",
      "",
      "TONE:",
      "- Dry, factual, auction-catalogue style",
      "- No marketing language",
      "- Assume expert reader",
      "",
      "ABSOLUTE PROHIBITIONS:",
      "- Do NOT define the product (no 'is a handbag', 'is a bag', 'this item').",
      "- Do NOT use adjectives such as luxury, iconic, elegant, timeless.",
      "- Do NOT infer lifestyle or usage.",
      "- Do NOT repeat dimensions outside the final paragraph.",
      "",
      "OPENING SENTENCE (CRITICAL):",
      "- ONE sentence only.",
      "- Must restate the full product identity using high-intent qualifiers.",
      "- Use one of these canonical patterns:",
      "  Pattern A: '[Brand] [Style] [Size] in [Colour] [Material] with [Hardware].'",
      "  Pattern B: '[Brand] [Style] [Size] in [Colour] ([Colour Code]) [Material] with [Hardware].'",
      "- Omit any element that is missing rather than padding.",
      "- No verbs like 'is', 'features', 'known for'.",
      "",
      "BODY COPY RULES:",
      "- Refer to the product using the combined brand + style name (e.g. 'Hermès Birkin', 'Chanel Boy Bag') at least once after the opening sentence.",
      "- Paragraph 2: size and construction only.",
      "- Use the combined brand + style name (e.g. 'Hermès Birkin', 'Hermès Kelly', 'Chanel Boy Bag') as the grammatical subject of at least one paragraph after the opening sentence, where it reads naturally.",
      "- Paragraph 3: material and colour characteristics only, based strictly on supplied descriptions.",
      "- Final paragraph: condition, stamp, receipt, accessories, dimensions, colour code.",
      "",
      "EDITOR’S NOTE:",
      "- If provided, output it verbatim as the FIRST paragraph.",
      "- Then continue with the structure above.",
      "",
      "OUTPUT RULES:",
      "- Plain text only.",
      "- British English.",
      "- No bullet points, no markdown, no HTML.",
      "- 100–180 words unless Editor’s Note is present.",
      "",
      "INPUT JSON:",
      JSON.stringify(
        {
          product,
          structured,
          editor_note: editorNote || undefined,
        },
        null,
        2
      ),
      "",
      "Write the description now, following every rule exactly.",
    ].join("\n");

    const completion = await withTimeout(
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a catalogue copywriter for a luxury resale business. Be precise, factual, and concise.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.15,
        presence_penalty: 0,
        frequency_penalty: 0,
      }),
      45000
    );

    const raw = completion.choices?.[0]?.message?.content || "";
    const descriptionText = stripCodeFences(raw);

    if (!descriptionText) {
      clearTimeout(timeout);
      return res.status(500).json({ error: "Empty AI output" });
    }

      clearTimeout(timeout);
      return res.status(200).json({ 
        description_html: descriptionText,
        product_id: product.id 
      });
  } catch (err) {
    clearTimeout(timeout);
    if (res.headersSent) return;
    return res.status(500).json({
      error: "Generation failed",
      details: err.message,
    });
  }
}