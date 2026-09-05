/**
 * SANAD Rule-Based Recommendation Engine
 *
 * Deterministically evaluates beneficiary eligibility and priority based on:
 * - Family size & dependents
 * - Monthly income & employment status
 * - Housing type & health vulnerabilities
 * - Open urgent needs
 * - 30-day recent distribution detector
 * - Real-time inventory matching against open needs
 *
 * All outputs include an advisory note explicitly stating human review is required.
 */

export const PRIORITY_LEVELS = {
  URGENT: 'urgent',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low'
};

export const PRIORITY_LABELS_AR = {
  urgent: 'عاجلة جداً',
  high: 'عالية',
  medium: 'متوسطة',
  low: 'منخفضة'
};

export const ADVISORY_DISCLAIMER_AR = 'هذه التوصية استرشادية لمساندة القرار البشري، والقرار النهائي يعود للموظف المختص.';

/**
 * Evaluates the beneficiary profile, needs, history, and inventory to produce a recommendation.
 *
 * @param {Object} params
 * @param {Object} params.beneficiary - Beneficiary profile record
 * @param {Array}  params.needs - List of open/partially fulfilled needs
 * @param {Array}  params.distributionHistory - History of past distributions
 * @param {Array}  params.inventoryItems - Available inventory items
 * @param {Date}   [params.now=new Date()] - Reference timestamp for time-based calculations
 * @returns {Object} Deterministic recommendation payload
 */
export function evaluateBeneficiaryRules({
  beneficiary = {},
  needs = [],
  distributionHistory = [],
  inventoryItems = [],
  now = new Date()
} = {}) {
  let score = 0;
  const reasons = [];
  const rawIncome = beneficiary.monthly_income ?? beneficiary.monthlyIncome;
  const parsedIncome = rawIncome !== null && rawIncome !== undefined && !isNaN(Number(rawIncome))
    ? Number(rawIncome)
    : null;

  const familySize = Number(beneficiary.family_size ?? beneficiary.familySize) || 0;
  const childrenCount = Number(beneficiary.children_count ?? beneficiary.childrenCount) || 0;
  const rawEmployment = beneficiary.employment_status ?? beneficiary.employmentStatus ?? '';
  const rawHousing = beneficiary.housing_type ?? beneficiary.housingType ?? '';
  const rawHealth = beneficiary.health_conditions ?? beneficiary.healthConditions ?? '';
  const rawVStatus = beneficiary.verification_status ?? beneficiary.verificationStatus ?? 'pending';

  const ruleInputs = {
    family_size: familySize || null,
    children_count: childrenCount || null,
    monthly_income: parsedIncome,
    employment_status: rawEmployment || null,
    housing_type: rawHousing || null,
    health_conditions: rawHealth || null,
    verification_status: rawVStatus,
    open_needs_count: needs.length
  };

  // 1. Family size evaluation
  if (familySize >= 7) {
    score += 25;
    reasons.push(`أسرة كبيرة جداً تتكون من ${familySize} أفراد`);
  } else if (familySize >= 5) {
    score += 15;
    reasons.push(`أسرة تتكون من ${familySize} أفراد`);
  } else if (familySize >= 3) {
    score += 8;
    reasons.push(`أسرة تتكون من ${familySize} أفراد`);
  }

  // 2. Children / Dependents evaluation
  if (childrenCount >= 4) {
    score += 20;
    reasons.push(`إعالة عدد كبير من الأطفال (${childrenCount} أطفال)`);
  } else if (childrenCount >= 2) {
    score += 10;
    reasons.push(`إعالة أطفال (${childrenCount} أطفال)`);
  } else if (childrenCount === 1) {
    score += 5;
    reasons.push('وجود طفل تحت الإعالة');
  }

  // 3. Employment status evaluation
  const employment = String(rawEmployment).trim().toLowerCase();
  const isUnemployed = /عاطل|unemployed|لا يعمل|بدون عمل|بلا عمل/i.test(employment);
  const isIrregular = /يومي|غير منتظم|مؤقت|part_time|temporary|day labor/i.test(employment);

  if (isUnemployed) {
    score += 25;
    reasons.push('رب الأسرة عاطل عن العمل أو بدون عمل ثابت');
  } else if (isIrregular) {
    score += 15;
    reasons.push('العمل غير منتظم أو مياومة مع دخل غير مستقر');
  }

  // 4. Monthly income evaluation
  if (parsedIncome !== null) {
    if (parsedIncome <= 500) {
      score += 25;
      reasons.push(`دخل شهري معدوم أو شديد الانخفاض (${parsedIncome} ر.س)`);
    } else if (parsedIncome <= 1500) {
      score += 20;
      reasons.push(`دخل شهري منخفض جداً دون حد الكفاية (${parsedIncome} ر.س)`);
    } else if (parsedIncome <= 3000) {
      score += 10;
      reasons.push(`دخل شهري محدود (${parsedIncome} ر.س)`);
    }
  }

  // 5. Health conditions & vulnerabilities
  const health = String(rawHealth).trim().toLowerCase();
  const hasChronicOrSevere = /مزمن|إعاقة|عجز|حرجة|مرض|علاج|chronic|disability|special/i.test(health);
  if (hasChronicOrSevere && health.length > 0) {
    score += 25;
    reasons.push('وجود أمراض مزمنة أو حالات إعاقة تتطلب رعاية ومصاريف دورية');
  }

  // 6. Housing type
  const housing = String(rawHousing).trim().toLowerCase();
  const isRentedOrVulnerable = /إيجار|rent|مأوى|مؤقت|shared|مشترك|مخيم/i.test(housing);
  if (isRentedOrVulnerable) {
    score += 15;
    reasons.push('سكن بالإيجار أو مأوى غير مستقر يثقل كاهل الأسرة بتكاليف إضافية');
  }

  // 7. Needs evaluation
  const openNeeds = (needs || []).filter(n => n.status === 'open' || n.status === 'partially_fulfilled');
  const hasUrgentNeed = openNeeds.some(n => n.priority === 'urgent');
  const hasHighNeed = openNeeds.some(n => n.priority === 'high');

  if (hasUrgentNeed) {
    score += 25;
    reasons.push('وجود طلبات احتياج طارئة وعاجلة مسجلة للنظام');
  } else if (hasHighNeed) {
    score += 15;
    reasons.push('وجود طلبات احتياج ذات أولوية عالية');
  }

  if (openNeeds.length >= 3) {
    score += 10;
    reasons.push(`تراكم الاحتياجات المفتوحة دون تلبية (${openNeeds.length} طلبات)`);
  }

  // 8. 30-Day Recent Support Detector
  const recentSupportWarning = checkRecentSupport(distributionHistory, now);
  ruleInputs.last_distribution_date = recentSupportWarning.lastDistributedAt;
  ruleInputs.days_since_last_distribution = recentSupportWarning.daysAgo;

  if (recentSupportWarning.hasRecentSupport) {
    reasons.push(`تنبيه تدقيق: استلم المستفيد دعماً مؤخراً منذ ${recentSupportWarning.daysAgo} يوماً (يتطلب تقييم الموظف للحالات الاستثنائية)`);
  } else if (recentSupportWarning.daysAgo !== null && recentSupportWarning.daysAgo >= 60) {
    reasons.push(`لم يتلق المستفيد أي دعم منذ أكثر من ${recentSupportWarning.daysAgo} يوماً`);
  } else if (recentSupportWarning.daysAgo === null) {
    reasons.push('حالة جديدة لم يسبق لها استلام أي مساعدات سابقة');
  }

  // 9. Verification status confirmation note
  const vStatus = beneficiary.verification_status || 'pending';
  if (vStatus === 'verified') {
    reasons.push('بيانات المستفيد مدققة وموثقة رسمياً');
  } else if (vStatus === 'needs_review') {
    reasons.push('ملف المستفيد محدد بحاجة لمراجعة أو استكمال وثائق');
  } else if (vStatus === 'pending') {
    reasons.push('ملف المستفيد قيد التدقيق الأولي');
  }

  // Map score to priority level
  let priorityLevel = PRIORITY_LEVELS.LOW;
  if (score >= 70 || hasUrgentNeed) {
    priorityLevel = PRIORITY_LEVELS.URGENT;
  } else if (score >= 45 || hasHighNeed) {
    priorityLevel = PRIORITY_LEVELS.HIGH;
  } else if (score >= 25) {
    priorityLevel = PRIORITY_LEVELS.MEDIUM;
  }

  // 10. Inventory Matching against open needs
  const suggestedItems = matchInventoryToNeeds(openNeeds, inventoryItems);

  return {
    priority_level: priorityLevel,
    priority_label_ar: PRIORITY_LABELS_AR[priorityLevel] || priorityLevel,
    score,
    reasons,
    recent_support_warning: recentSupportWarning,
    suggested_items: suggestedItems,
    rule_inputs: ruleInputs,
    advisory_disclaimer: ADVISORY_DISCLAIMER_AR
  };
}

/**
 * Checks if the beneficiary received any distribution within the last 30 days.
 *
 * @param {Array} distributions
 * @param {Date} now
 * @returns {Object} Recent support check details
 */
export function checkRecentSupport(distributions = [], now = new Date()) {
  if (!Array.isArray(distributions) || distributions.length === 0) {
    return {
      hasRecentSupport: false,
      daysAgo: null,
      lastDistributedAt: null,
      message: null
    };
  }

  // Filter completed distributions or distributions with dates
  const sortedDistributions = [...distributions]
    .filter(d => (d.distributed_at || d.distributedAt || d.created_at || d.createdAt))
    .sort((a, b) => {
      const dateA = new Date(a.distributed_at || a.distributedAt || a.created_at || a.createdAt);
      const dateB = new Date(b.distributed_at || b.distributedAt || b.created_at || b.createdAt);
      return dateB - dateA;
    });

  if (sortedDistributions.length === 0) {
    return {
      hasRecentSupport: false,
      daysAgo: null,
      lastDistributedAt: null,
      message: null
    };
  }

  const latest = sortedDistributions[0];
  const lastDate = new Date(latest.distributed_at || latest.distributedAt || latest.created_at || latest.createdAt);
  const diffMs = now.getTime() - lastDate.getTime();
  const daysAgo = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  const hasRecentSupport = daysAgo < 30;

  return {
    hasRecentSupport,
    daysAgo,
    lastDistributedAt: lastDate.toISOString(),
    distributionId: latest.id || null,
    message: hasRecentSupport
      ? `تنبيه: استفاد المستفيد من مساعدة خلال آخر 30 يوماً (منذ ${daysAgo} يوماً). التوصية للمراجعة والاستثناء وفق تقدير الموظف ولا تمنع الصرف.`
      : null
  };
}

/**
 * Matches open needs against available inventory stock.
 *
 * @param {Array} needs
 * @param {Array} inventoryItems
 * @returns {Array} Suggested items with match status
 */
export function matchInventoryToNeeds(needs = [], inventoryItems = []) {
  if (!Array.isArray(needs) || needs.length === 0) {
    return [];
  }

  const availableStock = (inventoryItems || []).filter(item => {
    const avail = Number(item.quantity_available ?? item.quantityAvailable);
    return avail > 0 && item.status !== 'archived';
  });

  const suggestions = [];

  for (const need of needs) {
    const qtyRequested = Number(need.quantity_requested ?? need.quantityRequested) || 0;
    const qtyFulfilled = Number(need.quantity_fulfilled ?? need.quantityFulfilled) || 0;
    const neededQuantity = Math.max(0, qtyRequested - qtyFulfilled);

    if (neededQuantity <= 0) continue;

    // Try matching by category and item name similarity
    const needCategory = (need.category || '').trim().toLowerCase();
    const needTitle = (need.title || '').trim().toLowerCase();

    // Direct category match or name containment
    const matchedItem = availableStock.find(item => {
      const itemCat = (item.category || '').trim().toLowerCase();
      const itemName = (item.name || '').trim().toLowerCase();
      return itemCat === needCategory ||
        (needCategory && itemCat.includes(needCategory)) ||
        (needTitle && itemName.includes(needTitle)) ||
        (itemName && needTitle.includes(itemName));
    });

    if (matchedItem) {
      const availQty = Number(matchedItem.quantity_available ?? matchedItem.quantityAvailable) || 0;
      const matchStatus = availQty >= neededQuantity ? 'full' : 'partial';

      suggestions.push({
        need_id: need.id,
        need_title: need.title,
        category: need.category,
        needed_quantity: neededQuantity,
        inventory_item_id: matchedItem.id,
        inventory_item_name: matchedItem.name,
        available_quantity: availQty,
        unit: matchedItem.unit || need.unit,
        match_status: matchStatus,
        match_label_ar: matchStatus === 'full' ? 'متوفر بالكامل' : 'متوفر جزئياً'
      });
    } else {
      suggestions.push({
        need_id: need.id,
        need_title: need.title,
        category: need.category,
        needed_quantity: neededQuantity,
        inventory_item_id: null,
        inventory_item_name: null,
        available_quantity: 0,
        unit: need.unit,
        match_status: 'none',
        match_label_ar: 'غير متوفر حالياً بالمخزون'
      });
    }
  }

  return suggestions;
}
