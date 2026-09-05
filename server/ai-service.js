// ============================================================================
// SANAD — AI Case Note Extraction Service (Phase 7)
// Extracts structured beneficiary & household data from raw Arabic case notes.
// Supports Google Gemini API (when configured) and seamlessly falls back
// to a deterministic Arabic NLP heuristic extractor.
// ============================================================================

const ARABIC_DIGITS_MAP = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9"
};

export const EGYPTIAN_GOVERNORATES = [
  "القاهرة", "الجيزة", "الإسكندرية", "القليوبية", "الشرقية", "الدقهلية",
  "المنوفية", "البحيرة", "الفيوم", "بني سويف", "المنيا", "أسيوط",
  "سوهاج", "قنا", "الأقصر", "أسوان", "كفر الشيخ", "دمياط", "بورسعيد",
  "الإسماعيلية", "السويس", "شمال سيناء", "جنوب سيناء", "البحر الأحمر",
  "الوادي الجديد", "مطروح", "الغربية"
];

export const MANDATORY_AI_DISCLAIMER =
  "تم استخراج هذه البيانات بواسطة الذكاء الاصطناعي — يرجى المراجعة والتدقيق البشري قبل الحفظ";

/**
 * Normalizes Eastern Arabic numerals (٠-٩) to standard ASCII digits (0-9).
 * @param {string} str
 * @returns {string}
 */
export function normalizeArabicNumbers(str) {
  if (!str || typeof str !== "string") return "";
  return str.replace(/[٠-٩]/g, (ch) => ARABIC_DIGITS_MAP[ch] || ch);
}

/**
 * Deterministic Arabic NLP rule-based entity extractor.
 * Extracts structured fields from unstructured Arabic case reports without external APIs.
 * @param {string} rawText
 * @returns {Object} Extracted structured data
 */
export function extractNotesHeuristic(rawText) {
  const text = normalizeArabicNumbers(String(rawText || "").trim());

  // 1. National ID (14 digits starting with 2 or 3 in Egypt)
  let nationalId = null;
  const nidMatch = text.match(/\b([23]\d{13})\b/);
  if (nidMatch) {
    nationalId = nidMatch[1];
  }

  // 2. Egyptian Phone Number (010, 011, 012, 015 followed by 8 digits)
  let phone = null;
  const phoneMatch = text.match(/(?:\+20\s?|0020\s?)?(01[0125]\d{8})(?:\D|$)/);
  if (phoneMatch) {
    phone = phoneMatch[1];
  }

  // 3. Governorate
  let governorate = null;
  for (const gov of EGYPTIAN_GOVERNORATES) {
    if (text.includes(gov)) {
      governorate = gov;
      break;
    }
  }

  // 4. District / Area
  let district = null;
  const distMatch = text.match(/(?:مركز|حي|منطقة|مدينة|قرية)\s+([\u0621-\u064A]{3,25})/u);
  if (distMatch && !EGYPTIAN_GOVERNORATES.includes(distMatch[1])) {
    district = distMatch[1].trim();
  }

  // 5. Name
  let name = null;
  const namePatterns = [
    /(?:المواطن|المواطنة|المستفيد|المستفيدة|رب الأسرة|السيد|السيدة|اسم المستفيد(?:\s*[:\-])?)\s+([\u0621-\u064A]{2,}(?:\s+[\u0621-\u064A]{2,}){1,4})/u,
    /(?:حالة|تقرير|زيارة)\s+([\u0621-\u064A]{2,}(?:\s+[\u0621-\u064A]{2,}){1,4})/u,
  ];
  for (const pattern of namePatterns) {
    const m = text.match(pattern);
    if (m && m[1]) {
      const candidate = m[1].trim();
      if (!candidate.startsWith("الأسرة") && !candidate.startsWith("الباحث")) {
        name = candidate;
        break;
      }
    }
  }

  // 6. Family Size
  let familySize = 1;
  const famPatterns = [
    /(?:تتكون الأسرة من|أسرة مكونة من|عدد أفراد الأسرة|الأسرة مكونة من|أفراد الأسرة)\s*[:\-]?\s*(\d+)/u,
    /(\d+)\s*(?:أفراد|فرد|أشخاص|نسمة)/u,
    /(?:أسرة من|الأسرة)\s*(\d+)/u,
  ];
  for (const pat of famPatterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      const parsed = parseInt(m[1], 10);
      if (parsed > 0 && parsed <= 30) {
        familySize = parsed;
        break;
      }
    }
  }

  // 7. Children Count
  let childrenCount = 0;
  const childPatterns = [
    /(?:بينهم|لديه|لديها|يعول|يعولها|عدد الأطفال|أطفال)\s*[:\-]?\s*(\d+)\s*(?:أطفال|طفل|أبناء|ابن|بنات)?/u,
    /(\d+)\s*(?:أطفال|أبناء|أولاد|بنات)/u,
  ];
  for (const pat of childPatterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      const parsed = parseInt(m[1], 10);
      if (parsed >= 0 && parsed <= familySize) {
        childrenCount = parsed;
        break;
      }
    }
  }

  // 8. School-Age Children
  let schoolAgeChildren = 0;
  const schoolPatterns = [
    /(?:منهم\s*)?(\d+)\s*(?:في سن المدرسة|بالمدرسة|بالمدارس|طلاب|تلاميذ|في مراحل التعليم)/u,
    /(?:طلاب|تلاميذ|أطفال بالمدارس)\s*[:\-]?\s*(\d+)/u,
  ];
  for (const pat of schoolPatterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      const parsed = parseInt(m[1], 10);
      if (parsed >= 0 && parsed <= (childrenCount || familySize)) {
        schoolAgeChildren = parsed;
        break;
      }
    }
  }

  // 9. Employment Status
  let employmentStatus = null;
  if (/عمالة\s+يومية/u.test(text) || /باليومية/u.test(text)) {
    const jobDetail = text.match(/عمالة\s+يومية(?:\s+في\s+([\u0621-\u064A]+))?/u);
    employmentStatus = jobDetail && jobDetail[1] ? `عمالة يومية (${jobDetail[1]})` : "عمالة يومية";
  } else if (/عمالة\s+غير\s+منتظمة|أرزقي/u.test(text)) {
    employmentStatus = "عمالة غير منتظمة";
  } else if (/بدون\s+عمل|عاطل(?:\s+عن\s+العمل)?|لا\s+يعمل/u.test(text)) {
    employmentStatus = "بدون عمل (عاطل)";
  } else if (/متقاعد|معاش/u.test(text) && !/تكافل/u.test(text)) {
    employmentStatus = "متقاعد";
  } else if (/ربة\s+منزل/u.test(text)) {
    employmentStatus = "ربة منزل";
  } else if (/سائق/u.test(text)) {
    employmentStatus = "سائق";
  } else if (/عامل\s+بناء/u.test(text)) {
    employmentStatus = "عامل بناء";
  } else if (/موظف/u.test(text)) {
    employmentStatus = "موظف";
  }

  // 10. Monthly Income
  let monthlyIncome = null;
  const incomePatterns = [
    /(?:دخل|راتب|معاش|يتقاضى)(?:\s+شهري(?:اً|ا)?)?(?:\s+يقدر\s+بـ|\s+حوالي|\s+قدره|\s+لا\s+يتجاوز|\s*[:\-])?\s*(\d+)\s*(?:جنيه|ج\.م)?/u,
    /(\d+)\s*(?:جنيه|ج\.م)(?:\s+شهري(?:اً|ا)?)?/u,
  ];
  for (const pat of incomePatterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      const parsed = parseInt(m[1], 10);
      if (parsed >= 0 && parsed < 100000) {
        monthlyIncome = parsed;
        break;
      }
    }
  }

  // 11. Housing Type
  let housingType = "إيجار جديد";
  if (/إيجار\s+جديد/u.test(text)) {
    housingType = "إيجار جديد";
  } else if (/إيجار\s+قديم/u.test(text)) {
    housingType = "إيجار قديم";
  } else if (/ملك|شقة\s+تمليك/u.test(text)) {
    housingType = "ملك";
  } else if (/غرفة\s+مشتركة/u.test(text)) {
    housingType = "غرفة مشتركة";
  } else if (/مأوى\s+مؤقت|عشوائيات|سقف\s+خشبي/u.test(text)) {
    housingType = "مأوى مؤقت";
  }

  // 12. Health Conditions
  const healthList = [];
  if (/سكري|سكر\b/u.test(text)) healthList.push("مرض السكري");
  if (/ضغط\b|ارتفاع\s+ضغط\s+الدم/u.test(text)) healthList.push("ارتفاع ضغط الدم");
  if (/قلب|عملية\s+قلب/u.test(text)) healthList.push("مرض بالقلب");
  if (/فشل\s+كلوي|غسيل\s+كلوي/u.test(text)) healthList.push("فشل كلوي");
  if (/إعاقة\s+حركية|شلل|ذوي\s+الاحتياجات/u.test(text)) healthList.push("إعاقة حركية");
  if (/علاج\s+شهري|أدوية\s+مزمنة/u.test(text)) healthList.push("يحتاج علاج شهري مستمر");
  if (/سرطان|أورام/u.test(text)) healthList.push("أورام خبيثة");

  const healthConditions = healthList.length > 0 ? healthList.join("، ") : null;

  // 13. Structured Needs Extraction
  const needs = [];

  // Food needs
  if (/طعام|غذائي|غذاء|طرد|كرتونة|تموين|لحوم|وجبات/u.test(text)) {
    needs.push({
      category: "طعام",
      description: "طرد مواد غذائية وتموين أساسي",
      priority: /عاجل|شديد|طارئ|لا\s+يجد/u.test(text) ? "urgent" : "high",
      quantity: 1
    });
  }

  // Clothing / School needs
  if (/كسوة|ملابس|حقائب|شنط|مدرسية|أدوات\s+مدرسية|أحذية/u.test(text)) {
    const qty = schoolAgeChildren > 0 ? schoolAgeChildren : (childrenCount > 0 ? childrenCount : 1);
    needs.push({
      category: "كسوة",
      description: "كسوة ومستلزمات مدرسية للأطفال",
      priority: "high",
      quantity: qty
    });
  }

  // Medical needs
  if (healthConditions || /دواء|علاج|عملية\s+جراحية|مستلزمات\s+طبية/u.test(text)) {
    needs.push({
      category: "أدوية ومستلزمات طبية",
      description: healthConditions ? `دعم دوائي وعلاجي (${healthConditions})` : "أدوية ومستلزمات طبية عاجلة",
      priority: "urgent",
      quantity: 1
    });
  }

  // Appliances / Home furnishings
  if (/غسالة|ثلاجة|بوتاجاز|سخان|بطاطين|بطانية|مراتب|أجهزة\s+منزلية/u.test(text)) {
    const appMatches = [];
    if (/غسالة/u.test(text)) appMatches.push("غسالة");
    if (/ثلاجة/u.test(text)) appMatches.push("ثلاجة");
    if (/بوتاجاز/u.test(text)) appMatches.push("بوتاجاز");
    if (/بطاطين|بطانية/u.test(text)) appMatches.push("بطاطين شتوية");
    needs.push({
      category: "أجهزة وأثاث منزلي",
      description: appMatches.length > 0 ? appMatches.join(" و") : "أجهزة وأثاث منزلي أساسي",
      priority: "medium",
      quantity: appMatches.length || 1
    });
  }

  // Emergency / Rent / Cash assistance
  if (/إيجار\s+متأخر|طرد\s+من\s+السكن|مساعدة\s+مالية|ديون|دين/u.test(text)) {
    needs.push({
      category: "مساعدات طارئة",
      description: "مساعدة طارئة لدعم السكن والأعباء المتراكمة",
      priority: "urgent",
      quantity: 1
    });
  }

  // Default need if none caught
  if (needs.length === 0) {
    needs.push({
      category: "طعام",
      description: "مساعدة غذائية عامة",
      priority: "medium",
      quantity: 1
    });
  }

  // 14. Concise Summary
  const summaryParts = [];
  if (name) summaryParts.push(`حالة المواطن ${name}`);
  if (governorate) summaryParts.push(`بمحافظة ${governorate}`);
  if (familySize > 1) summaryParts.push(`أسرة من ${familySize} أفراد (${childrenCount} أطفال)`);
  if (employmentStatus) summaryParts.push(`العمل: ${employmentStatus}`);
  if (monthlyIncome !== null) summaryParts.push(`الدخل: ${monthlyIncome} ج.م`);
  if (healthConditions) summaryParts.push(`ظروف صحية: ${healthConditions}`);
  const summary = summaryParts.join("، ") || "تقرير حالة اجتماعية مستخرج آلياً.";

  return {
    name,
    phone,
    nationalId,
    governorate,
    district,
    familySize,
    childrenCount,
    schoolAgeChildren,
    employmentStatus,
    monthlyIncome,
    housingType,
    healthConditions,
    needs,
    summary,
  };
}

/**
 * Calls the Google Gemini API to extract structured entities from Arabic case notes.
 * @param {string} text Raw case notes
 * @param {string} apiKey Gemini API Key
 * @returns {Promise<Object>} Extracted JSON structure
 */
async function callGeminiExtractor(text, apiKey) {
  const model = process.env.AI_MODEL || "gemini-1.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const systemInstruction = `
أنت خبير اجتماعي ومساعد استخراج ذكي لمنصة "سَنَد" (SANAD) لإدارة المساعدات الإنسانية في مصر والعالم العربي.
مهمتك: قراءة التقرير الميداني الاجتماعي غير المنظم واستخراج البيانات المهيكلة للأسر بدقة وفق المواصفات التالية:
- name: اسم رب الأسرة أو المستفيد الكامل (نص أو null)
- phone: رقم الهاتف المصري (010, 011, 012, 015 - 11 رقماً) أو null
- nationalId: الرقم القومي المصري المكون من 14 رقماً أو null
- governorate: اسم المحافظة المصرية من المحافظات الرسمية (مثل القاهرة، الجيزة، الإسكندرية...) أو null
- district: المركز أو الحي أو المنطقة أو null
- familySize: إجمالي عدد أفراد الأسرة كرقم صحيح (>= 1)
- childrenCount: عدد الأطفال كرقم صحيح (>= 0)
- schoolAgeChildren: عدد الأطفال في سن المدرسة كرقم صحيح (>= 0)
- employmentStatus: طبيعة العمل (مثل عمالة يومية، بدون عمل، موظف...) أو null
- monthlyIncome: الدخل الشهري بالجنيه المصري كرقم صحيح أو null
- housingType: نوع السكن (إيجار جديد، إيجار قديم، ملك، غرفة مشتركة، مأوى مؤقت)
- healthConditions: وصف مختصر للأمراض المزمنة أو الإعاقات أو null
- needs: مصفوفة من الاحتياجات العينية المطلوبة، كل عنصر يحتوي على:
  - category: الفئة (طعام، كسوة، أدوية ومستلزمات طبية، أجهزة وأثاث منزلي، مساعدات طارئة)
  - description: تفاصيل الصنف المطلوب
  - priority: درجة الأولوية (urgent, high, medium, low)
  - quantity: الكمية التقديرية (رقم صحيح >= 1)
- summary: ملخص عربي موجز ومركز للحالة في سطرين.

أخرج النتيجة بصيغة JSON فقط متطابقة مع هذا المخطط.
`;

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [
          { text: `استخرج البيانات الاجتماعية من التقرير الميداني التالي:\n\n${text}` }
        ]
      }
    ],
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json"
    }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini API returned status ${res.status}: ${errText}`);
    }

    const json = await res.json();
    const candidateText = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      throw new Error("Gemini response did not contain candidates content.");
    }

    const parsed = JSON.parse(candidateText);
    return parsed;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Normalizes, sanitizes, and enforces sanity limits on extracted data fields.
 * @param {Object} raw
 * @returns {Object} Clean validated data
 */
function sanitizeExtractedData(raw) {
  const data = raw || {};

  const name = typeof data.name === "string" && data.name.trim().length >= 2
    ? data.name.trim().slice(0, 120)
    : null;

  let phone = typeof data.phone === "string" ? data.phone.replace(/[^\d+]/g, "") : null;
  if (phone && phone.length > 20) phone = phone.slice(0, 20);

  let nationalId = typeof data.nationalId === "string" ? data.nationalId.replace(/\D/g, "") : null;
  if (nationalId && nationalId.length !== 14) nationalId = null;

  const governorate = typeof data.governorate === "string" && data.governorate.trim().length > 0
    ? data.governorate.trim()
    : null;

  const district = typeof data.district === "string" && data.district.trim().length > 0
    ? data.district.trim().slice(0, 80)
    : null;

  const familySize = Math.max(1, Math.min(30, parseInt(data.familySize, 10) || 1));
  const childrenCount = Math.max(0, Math.min(familySize, parseInt(data.childrenCount, 10) || 0));
  const schoolAgeChildren = Math.max(0, Math.min(childrenCount || familySize, parseInt(data.schoolAgeChildren, 10) || 0));

  const employmentStatus = typeof data.employmentStatus === "string" && data.employmentStatus.trim().length > 0
    ? data.employmentStatus.trim().slice(0, 80)
    : null;

  const monthlyIncome = data.monthlyIncome != null && !isNaN(Number(data.monthlyIncome))
    ? Math.max(0, Math.min(1000000, Number(data.monthlyIncome)))
    : null;

  const housingType = typeof data.housingType === "string" && data.housingType.trim().length > 0
    ? data.housingType.trim()
    : "إيجار جديد";

  const healthConditions = typeof data.healthConditions === "string" && data.healthConditions.trim().length > 0
    ? data.healthConditions.trim().slice(0, 500)
    : null;

  const needs = Array.isArray(data.needs)
    ? data.needs.map(n => ({
        category: typeof n.category === "string" && n.category.trim().length > 0 ? n.category.trim() : "طعام",
        description: typeof n.description === "string" && n.description.trim().length > 0 ? n.description.trim().slice(0, 250) : "مساعدة عينية",
        priority: ["urgent", "high", "medium", "low"].includes(n.priority) ? n.priority : "medium",
        quantity: Math.max(1, Math.min(100, parseInt(n.quantity, 10) || 1))
      }))
    : [];

  const summary = typeof data.summary === "string" && data.summary.trim().length > 0
    ? data.summary.trim().slice(0, 1000)
    : "تم استخراج بيانات الحالة بنجاح.";

  return {
    name,
    phone,
    nationalId,
    governorate,
    district,
    familySize,
    childrenCount,
    schoolAgeChildren,
    employmentStatus,
    monthlyIncome,
    housingType,
    healthConditions,
    needs,
    summary,
  };
}

/**
 * Main service entry point: Analyzes unstructured case notes and returns structured fields.
 * Guarantees a response even if the external LLM is unreachable or unconfigured.
 *
 * @param {string} rawNotes
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function extractCaseNotes(rawNotes, options = {}) {
  const text = String(rawNotes || "").trim();

  if (!text || text.length < 10) {
    const err = new Error("نص الملاحظات قصير جداً؛ يرجى تقديم تقرير مفصل يحتوي على 10 أحرف على الأقل.");
    err.code = "NOTE_TOO_SHORT";
    err.statusCode = 400;
    throw err;
  }

  if (text.length > 10000) {
    const err = new Error("نص الملاحظات يتجاوز الحد الأقصى المسموح به (10,000 حرف).");
    err.code = "NOTE_TOO_LONG";
    err.statusCode = 400;
    throw err;
  }

  const apiKey = (process.env.GEMINI_API_KEY || process.env.AI_API_KEY || "").trim();
  let resultData = null;
  let provider = "heuristic_fallback";

  if (apiKey && options.forceHeuristic !== true) {
    try {
      const geminiResult = await callGeminiExtractor(text, apiKey);
      resultData = sanitizeExtractedData(geminiResult);
      provider = "gemini";
    } catch (err) {
      console.warn("Gemini API call failed or timed out, falling back to Arabic NLP heuristics:", err.message);
    }
  }

  if (!resultData) {
    const heuristicResult = extractNotesHeuristic(text);
    resultData = sanitizeExtractedData(heuristicResult);
    provider = "heuristic_fallback";
  }

  return {
    success: true,
    provider,
    disclaimer: MANDATORY_AI_DISCLAIMER,
    data: resultData
  };
}
