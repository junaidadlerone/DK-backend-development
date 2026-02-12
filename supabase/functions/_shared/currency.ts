export interface CurrencyEnrichment {
  value: number;
  currency_code: string;
  symbol: string;
  formatted: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CAD: "C$",
  AUD: "A$",
  CHF: "Fr.",
  CNY: "¥",
  INR: "₹",
  // Add common defaults
};

/**
 * Enriches a numeric amount with currency formatting information.
 * 
 * @param amount - The numeric amount (e.g., 10.50)
 * @param currencyCode - The currency code (e.g., "usd", "EUR")
 * @returns CurrencyEnrichment object
 */
export function enrichCurrency(
  amount: number,
  currencyCode: string
): CurrencyEnrichment {
  // Handle missing or invalid inputs
  if (amount === undefined || amount === null) {
      return {
          value: 0,
          currency_code: (currencyCode || "USD").toUpperCase(),
          symbol: getCurrencySymbol(currencyCode),
          formatted: formatCurrency(0, currencyCode)
      };
  }

  const code = (currencyCode || "USD").toUpperCase();
  const symbol = getCurrencySymbol(code);

  return {
    value: amount,
    currency_code: code,
    symbol: symbol,
    formatted: formatCurrency(amount, code)
  };
}

export function getCurrencySymbol(currencyCode: string): string {
  const code = (currencyCode || "USD").toUpperCase();
  // Try to use Intl.NumberFormat to get symbol if possible, otherwise fallback map
  try {
      const parts = new Intl.NumberFormat('en-US', { 
          style: 'currency', 
          currency: code 
      }).formatToParts(0);
      const symbolPart = parts.find(part => part.type === 'currency');
      return symbolPart ? symbolPart.value : (CURRENCY_SYMBOLS[code] || code);
  } catch {
      return CURRENCY_SYMBOLS[code] || code;
  }
}

function formatCurrency(
  amount: number,
  code: string
): string {
  try {
      const formatter = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
        // Standardize to 2 decimal places for most currencies
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    
      return formatter.format(amount);
  } catch (error) {
      // Fallback simple formatting
      const symbol = CURRENCY_SYMBOLS[code] || code + " ";
      return `${symbol}${amount.toFixed(2)}`;
  }
}
