export function price(amount: number, rate: number, intra: boolean) {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000 || ![0,5,12,18,28].includes(rate)) throw new Error('Invalid amount or tax rate');
  const cgstPaise = intra ? Math.round(amount * rate / 200) : 0;
  const sgstPaise = cgstPaise;
  const igstPaise = intra ? 0 : Math.round(amount * rate / 100);
  return { subtotalPaise: amount, gstRate: rate, cgstPaise, sgstPaise, igstPaise, totalPaise: amount + cgstPaise + sgstPaise + igstPaise };
}
