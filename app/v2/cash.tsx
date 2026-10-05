import { useState, useEffect, useMemo } from "react";
import { DENOMINATIONS, calculateBreakdownTotal, summariseBreakdown } from "@/lib/domain/cashDenominations";
import { Button, Panel } from "./ui";

export function CashCounter({ 
  onChange, 
  initialBreakdown,
  disabled
}: { 
  onChange: (breakdown: Record<string, number>, totalPaise: number) => void,
  initialBreakdown?: Record<string, number>,
  disabled?: boolean
}) {
  const [breakdown, setBreakdown] = useState<Record<string, number>>(initialBreakdown || {});

  useEffect(() => {
    const totalPaise = calculateBreakdownTotal(breakdown);
    onChange(breakdown, totalPaise);
  }, [breakdown, onChange]);

  const { noteCount, coinCount } = summariseBreakdown(breakdown);
  const totalAmount = calculateBreakdownTotal(breakdown) / 100;

  function updateCount(key: string, delta: number) {
    if (disabled) return;
    setBreakdown(prev => {
      const current = prev[key] || 0;
      const next = Math.max(0, Math.min(9999, current + delta));
      return { ...prev, [key]: next };
    });
  }

  return (
    <Panel title="Count your cash">
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
        <div className="font-bold text-lg">Total: ₹{totalAmount.toFixed(2)}</div>
        <Button variant="secondary" onClick={() => setBreakdown({})} disabled={disabled}>Reset all</Button>
      </div>
    </Panel>
  );
}
