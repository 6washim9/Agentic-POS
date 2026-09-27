export type VoiceParseResult = {
  intent: string;
  confidence: number;
  entities: Record<string, unknown>;
  needsFallback: boolean;
  original: string;
};

const SKU_ALIASES: Record<string, string> = {
  fuji: "Fuji Apples",
  apple: "Fuji Apples",
  am: "Mango",
  mango: "Mango",
  kola: "Banana",
  banana: "Banana",
  komola: "Orange",
  orange: "Orange",
  angur: "Grapes",
  grape: "Grapes",
};

export function parseVoiceCommand(utterance: string): VoiceParseResult {
  const original = utterance;
  const text = utterance.trim().toLowerCase().replace(/\s+/g, " ");
  const entities: Record<string, unknown> = {};

  const qtyMatch = text.match(/(\d+)\s*(crates?|box(?:es)?)/);
  if (qtyMatch) {
    entities.qty = Number(qtyMatch[1]);
    const unitRaw = qtyMatch[2] ?? "crate";
    entities.unit = unitRaw.includes("crate") ? "crate" : "box";
  }

  const amountMatch = text.match(
    /(?:for|taka|tk|bdt|টাকা)\s*(\d[\d,]*)|(\d[\d,]*)\s*(?:taka|tk|bdt|টাকা)/,
  );
  if (amountMatch) {
    const raw = (amountMatch[1] || amountMatch[2] || "0").replace(/,/g, "");
    entities.amount = Number(raw);
  }

  for (const [alias, sku] of Object.entries(SKU_ALIASES)) {
    if (text.includes(alias)) {
      entities.sku = sku;
      break;
    }
  }

  const customerMatch = text.match(/(?:to|ke|কে)\s+([a-z]+)/);
  if (customerMatch) {
    entities.customer = customerMatch[1][0].toUpperCase() + customerMatch[1].slice(1);
  } else if (text.includes("rahim") || text.includes("রহিম")) {
    entities.customer = "Rahim";
  }

  if (/(credit|baki|udhar)/.test(text)) entities.on_credit = true;
  else if (/(cash|nogod|paid)/.test(text)) entities.on_credit = false;

  const gradeMatch = text.match(/grade\s*([abc])/);
  if (gradeMatch) entities.grade = gradeMatch[1].toUpperCase();

  let intent = "unknown";
  let confidence = 0.35;
  if (/(sold|sale|dilam|bikri|sell)/.test(text)) {
    intent = "sale";
    confidence = entities.qty ? 0.92 : 0.72;
  } else if (/(spoil|wastage|noshto|rotten)/.test(text)) {
    intent = "spoilage";
    confidence = entities.qty ? 0.9 : 0.7;
    entities.grade = entities.grade ?? "C";
  } else if (/(remind|reminder|sms|whatsapp)/.test(text)) {
    intent = "debt_reminder";
    confidence = 0.88;
  } else if (/(receive|payment|joma|জমা)/.test(text)) {
    intent = "payment";
    confidence = 0.9;
  } else if (/(warehouse|gudam|cold)/.test(text)) {
    intent = "warehouse_move";
    confidence = 0.85;
  }

  return {
    intent,
    confidence,
    entities,
    needsFallback: confidence < 0.8,
    original,
  };
}
