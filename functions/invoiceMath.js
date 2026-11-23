// Pure invoice helpers (no Firebase), so the arithmetic can be tested on its own.
// All money is handled in paise (integers) to avoid floating-point errors.

const STATES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '28': 'Andhra Pradesh (old)',
  '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', OUT: 'Outside India',
};
const GST_RATES = [0, 5, 12, 18, 28];
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const toPaise = (n) => Math.round(Number(n) * 100);

// Validates and prices the invoice lines. Throws Error with a user-friendly message.
function priceLines(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, 20) : [];
  if (!list.length) throw new Error('Add at least one invoice line.');
  return list.map((l, i) => {
    const desc = String(l?.desc ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const qty = Number(l?.qty), rate = Number(l?.rate);
    if (desc.length < 2) throw new Error(`Line ${i + 1}: enter a description.`);
    if (!(qty >= 0.01 && qty <= 10000)) throw new Error(`Line ${i + 1}: quantity must be between 0.01 and 10000.`);
    if (!(rate >= 0 && rate <= 1e7)) throw new Error(`Line ${i + 1}: enter the price in rupees, before GST.`);
    const ratePaise = toPaise(rate);
    return { desc, qty, ratePaise, amountPaise: Math.round(qty * ratePaise) };
  });
}

// GST: same state -> CGST + SGST (half each), other state -> IGST, outside India or unregistered seller -> none.
function computeTax(subtotalPaise, { registered, sellerState, buyerState, rate }) {
  if (!registered || buyerState === 'OUT') return { taxMode: 'none', gstRate: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
  if (!GST_RATES.includes(rate)) throw new Error('GST rate must be 0, 5, 12, 18 or 28.');
  if (buyerState === sellerState) {
    const half = Math.round((subtotalPaise * rate) / 200);
    return { taxMode: 'intra', gstRate: rate, cgstPaise: half, sgstPaise: half, igstPaise: 0 };
  }
  return { taxMode: 'inter', gstRate: rate, cgstPaise: 0, sgstPaise: 0, igstPaise: Math.round((subtotalPaise * rate) / 100) };
}

// Indian financial year (1 April to 31 March). `d` is a Date already shifted to IST.
function financialYear(d) {
  const y = d.getUTCFullYear(), start = d.getUTCMonth() >= 3 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}
const istNow = () => new Date(Date.now() + 5.5 * 3600e3);
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);

// Next document number. Tax invoices and proformas have separate series per financial year.
function nextNumber(counter, kind, prefix, fy) {
  const key = `${kind === 'proforma' ? 'pro' : 'inv'}_${fy.replace('-', '')}`;
  const n = ((counter || {})[key] || 0) + 1;
  const number = `${kind === 'proforma' ? 'PRO' : prefix}/${fy}/${String(n).padStart(4, '0')}`; // 16 characters at most
  return { key, n, number, id: number.replace(/\//g, '-') };
}

module.exports = { nextNumber, STATES, GST_RATES, GSTIN_RE, toPaise, priceLines, computeTax, financialYear, istNow, ymd, addDays };
