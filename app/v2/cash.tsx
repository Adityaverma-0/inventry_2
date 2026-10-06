import { useState, useEffect, useMemo } from "react";
import { DENOMINATIONS, calculateBreakdownTotal, summariseBreakdown } from "@/lib/domain/cashDenominations";
import { Button, Panel, Field, Input } from "./ui";

export function CashCounter({
  onChange,
  initialBreakdown,
  disabled,
  maxAmount
}: {
  onChange: (breakdown: Record<string, number>, totalPaise: number, upiAmount: number, bankAmount: number) => void,
  initialBreakdown?: Record<string, number>,
  disabled?: boolean,
  maxAmount?: number
}) {
  const [breakdown, setBreakdown] = useState<Record<string, number>>(initialBreakdown || {});
  const [upiAmount, setUpiAmount] = useState(0);
  const [bankAmount, setBankAmount] = useState(0);

  useEffect(() => {
    const totalPaise = calculateBreakdownTotal(breakdown) + (upiAmount * 100) + (bankAmount * 100);
    onChange(breakdown, totalPaise, upiAmount, bankAmount);
  }, [breakdown, upiAmount, bankAmount, onChange]);

  const { noteCount, coinCount } = summariseBreakdown(breakdown);
  const totalCash = calculateBreakdownTotal(breakdown) / 100;
  const totalPayment = totalCash + upiAmount + bankAmount;
  const isError = maxAmount != null && (totalPayment * 100) > maxAmount;

  function updateCount(key: string, delta: number) {
    if (disabled) return;
    setBreakdown(prev => {
      const current = prev[key] || 0;
      const next = Math.max(0, Math.min(9999, current + delta));
      return { ...prev, [key]: next };
    });
  }

  return (
    <Panel title="Count your payments">
      <div className="sd-form" style={{ marginBottom: 16 }}>
        <Field label="UPI Amount (₹)">
          <Input type="number" value={upiAmount} onChange={(e) => setUpiAmount(Number(e.target.value))} min={0} disabled={disabled} />
        </Field>
        <Field label="Bank Transfer (₹)">
          <Input type="number" value={bankAmount} onChange={(e) => setBankAmount(Number(e.target.value))} min={0} disabled={disabled} />
        </Field>
      </div>

      {DENOMINATIONS.map(denom => (
        <div key={denom.key} className="flex justify-between items-center py-2 border-b">
          <span>{denom.label}</span>
          <div className="flex items-center gap-2">
            <Button onClick={() => updateCount(denom.key, -1)} disabled={disabled || (breakdown[denom.key] || 0) <= 0}>-</Button>
            <span className="w-12 text-center">{breakdown[denom.key] || 0}</span>
            <Button onClick={() => updateCount(denom.key, 1)} disabled={disabled}>+</Button>
          </div>
          <span className="w-20 text-right">₹{((breakdown[denom.key] || 0) * denom.value).toFixed(2)}</span>
        </div>
      ))}
      <div className="sticky bottom-0 bg-white p-4 border-t mt-4 flex items-center justify-between">
        <div className="text-sm">Notes: {noteCount} | Coins: {coinCount}</div>
        <div className={`font-bold text-lg ${isError ? 'text-red-500' : ''}`}>
          Total: ₹{totalPayment.toFixed(2)}
          {isError && <div className="text-sm">Total payment exceeds expected amount!</div>}
        </div>
        <Button variant="secondary" onClick={() => { setBreakdown({}); setUpiAmount(0); setBankAmount(0); }} disabled={disabled}>Reset all</Button>
      </div>
    </Panel>
  );
}
