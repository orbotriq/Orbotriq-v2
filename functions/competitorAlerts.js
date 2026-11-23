// Pure helper: turns the last two competitor snapshots into alerts. Used by the daily alert job.
exports.fromHistory = (b, h) => {
  const out = [], seo = h?.seo || [], soc = h?.social || [];
  const push = (a) => out.push({ severity: 'warning', institutionId: b.id, ...a });
  if (seo.length >= 2) {
    const p = seo[seo.length - 2], c = seo[seo.length - 1];
    for (const [n, sc] of Object.entries(c.c || {})) {
      const pv = p.c?.[n];
      if (pv == null) continue;
      if (sc >= pv + 10) push({ type: 'competitor_seo', key: `cseo:${b.id}:${n}:${sc}`, title: `${n}’s SEO score jumped`, detail: `${b.name}: ${n} went from ${pv} to ${sc} on the homepage check. Yours is ${c.you}. Open Competitors to see what changed.` });
      if (pv <= p.you && sc > c.you) push({ type: 'competitor_seo', key: `cseoo:${b.id}:${n}:${sc}:${c.you}`, title: `${n} now outscores you on SEO`, detail: `${b.name}: ${n} scores ${sc} against your ${c.you} on the homepage check. Open Competitors to see where they are ahead.` });
    }
  }
  if (soc.length >= 2) {
    const p = soc[soc.length - 2], c = soc[soc.length - 1];
    for (const [n, v] of Object.entries(c.c || {})) {
      const o = p.c?.[n];
      if (!o || !o.f || v.f == null) continue;
      const gain = v.f - o.f, pct = Math.round((gain / o.f) * 1000) / 10;
      if (gain >= 100 && pct >= 10) push({ type: 'competitor_growth', key: `cgrow:${b.id}:${n}:${v.f}`, title: `${n} is gaining Instagram followers fast`, detail: `${b.name}: ${n} grew from ${o.f} to ${v.f} followers (+${pct}%) since the last check. Yours: ${c.you?.f ?? 'n/a'}.` });
      if (o.e != null && p.you?.e != null && v.e != null && c.you?.e != null && o.e <= p.you.e && v.e > c.you.e) push({ type: 'competitor_engagement', key: `ceng:${b.id}:${n}:${v.e}:${c.you.e}`, title: `${n} now beats you on Instagram engagement`, detail: `${b.name}: ${n} engagement is ${v.e}% against your ${c.you.e}%. Open Competitors to compare posting rate and likes.` });
    }
  }
  return out;
};

// Facts for the client report: latest competitor comparison plus change since the previous run.
exports.factsForReport = (M, id) => {
  const cs = M['cmpseo_' + id], co = M['cmpsoc_' + id], ch = M['cmphist_' + id] || {};
  const ps = (ch.seo || []).length > 1 ? ch.seo[ch.seo.length - 2] : null, po = (ch.social || []).length > 1 ? ch.social[ch.social.length - 2] : null;
  const iso = (t) => t?.toDate?.()?.toISOString?.() || null;
  const seo = cs?.you ? {
    you: cs.you.score, youPrev: ps?.you ?? null, checkedAt: iso(cs.checkedAt), gaps: (cs.gaps || []).slice(0, 4),
    items: (cs.items || []).filter((i) => !i.error && i.score != null).map((i) => ({ name: i.name, score: i.score, prev: ps?.c?.[i.name] ?? null })),
  } : null;
  const social = co?.you ? {
    checkedAt: iso(co.checkedAt),
    you: { followers: co.you.followers ?? null, engagementRate: co.you.engagementRate ?? null, postsPerWeek: co.you.postsPerWeek ?? null, prevFollowers: po?.you?.f ?? null },
    items: (co.items || []).filter((i) => !i.error && i.followers != null).map((i) => ({ name: i.name, followers: i.followers, engagementRate: i.engagementRate ?? null, postsPerWeek: i.postsPerWeek ?? null, prevFollowers: po?.c?.[i.name]?.f ?? null })),
  } : null;
  return { seo: seo && seo.items.length ? seo : null, social: social && social.items.length ? social : null };
};
