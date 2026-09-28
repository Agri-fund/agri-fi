# Frontend Component Library & Patterns Guide

This guide documents the reusable UI component library, custom React hooks, and API client patterns used in the Agri-Fi web application.

The core primitives are located in [`frontend/src/components/ui`](../src/components/ui), custom hooks in [`frontend/src/hooks`](../src/hooks), and API communication utilities in [`frontend/src/lib/api.ts`](../src/lib/api.ts).

---

## 1. Architecture & Design Principles

Our component architecture is inspired by modern design systems like **shadcn/ui** and **Radix UI**:

1. **Domain-Agnostic Primitives**: Components in `components/ui/` have **zero** agricultural or blockchain domain knowledge. They are pure presentation and interaction primitives (inputs, modals, dropzones, tables).
2. **Tailwind CSS Styling**: Styles are composed via utility classes using our curated theme palette (Emeralds `#059669`, Slate neutrals, Amber warnings, and Rose errors).
3. **Compound & Composable**: Complex components expose sub-components or render-props rather than accepting dozens of disjoint configuration flags.
4. **Accessibility First**: Keyboard navigation (`Tab`, `Escape`, `Enter`), proper ARIA roles (`role="dialog"`, `aria-expanded`, `aria-invalid`), and visible focus rings (`focus-visible:ring-2 focus-visible:ring-emerald-500`) are mandatory.
5. **Strict TypeScript Interfaces**: All components export their prop types with descriptive JSDoc comments.

---

## 2. UI Component Inventory

| Component | File Path | Primary Use Case | Key Props |
|---|---|---|---|
| **Input** | `components/ui/Input.tsx` | Form text, email, number inputs | `label`, `error`, `helperText`, `startIcon`, `endIcon` |
| **Select** | `components/ui/Select.tsx` | Custom dropdown selector | `options`, `value`, `onChange`, `placeholder`, `error` |
| **CurrencyInput** | `components/ui/CurrencyInput.tsx` | Monetary input with currency switcher | `value`, `currency`, `onCurrencyChange`, `onChange` |
| **Dropzone** | `components/ui/Dropzone.tsx` | Drag-and-drop file upload | `accept`, `maxSize`, `onDrop`, `multiple`, `error` |
| **ChunkedUpload** | `components/ui/ChunkedUpload.tsx` | Resumable large document/video upload | `uploadUrl`, `chunkSize`, `onProgress`, `onSuccess` |
| **DataTable** | `components/ui/DataTable.tsx` | Generic tabular data display | `columns`, `data`, `loading`, `pagination`, `onRowClick` |
| **ModalWrapper** | `components/ui/ModalWrapper.tsx` | Accessible dialog with portal & backdrop | `isOpen`, `onClose`, `title`, `description`, `children` |
| **Pagination** | `components/ui/Pagination.tsx` | Table and card grid navigation | `currentPage`, `totalPages`, `onPageChange` |
| **PdfViewer** | `components/ui/PdfViewer.tsx` | Inline document previewer | `fileUrl`, `initialPage`, `showDownload`, `onLoadSuccess` |
| **ToastProvider** | `components/ui/ToastProvider.tsx` | Application-wide toast notifications | `addToast(title, message, type)`, `toasts` |
| **Tooltip** | `components/ui/Tooltip.tsx` | Hover/focus contextual tooltip | `content`, `position`, `delay`, `children` |
| **CopyButton** | `components/ui/CopyButton.tsx` | One-click copy for hashes & addresses | `text`, `label`, `feedbackDuration` |

---

## 3. Component Usage Examples

### `Input` with Validation and Icons
```tsx
import { Input } from '@/components/ui/Input';
import { Mail } from 'lucide-react';

export function EmailField({ value, onChange, error }) {
  return (
    <Input
      label="Email Address"
      type="email"
      placeholder="investor@example.com"
      value={value}
      onChange={onChange}
      error={error}
      startIcon={<Mail className="w-4 h-4 text-slate-400" />}
      helperText="We will send deal confirmation and receipts to this email."
    />
  );
}
```

### `CurrencyInput` with Real-Time Conversion
```tsx
import { CurrencyInput } from '@/components/ui/CurrencyInput';

export function InvestmentAmount({ amount, currency, setAmount, setCurrency }) {
  return (
    <CurrencyInput
      label="Investment Capital"
      value={amount}
      currency={currency}
      currencies={['USD', 'KES', 'NGN', 'GHS']}
      onChange={(newAmount) => setAmount(newAmount)}
      onCurrencyChange={(newCurrency) => setCurrency(newCurrency)}
      min={100}
    />
  );
}
```

### `ModalWrapper` for Dialogs
```tsx
import { ModalWrapper } from '@/components/ui/ModalWrapper';

export function ConfirmFundingModal({ isOpen, onClose, onConfirm, dealTitle }) {
  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      title="Confirm Escrow Funding"
      description={`You are committing funds to the trade deal "${dealTitle}".`}
    >
      <div className="py-4">
        <p className="text-sm text-slate-600">
          Funds will be deposited into the Stellar multi-sig escrow contract and released upon shipment verification.
        </p>
      </div>
      <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
          Cancel
        </button>
        <button onClick={onConfirm} className="px-4 py-2 text-sm text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg font-medium">
          Confirm & Sign
        </button>
      </div>
    </ModalWrapper>
  );
}
```

---

## 4. Custom Hooks Catalog

Hooks provide encapsulated state management and utility logic across all dashboard and marketplace pages:

| Hook | File Path | Purpose |
|---|---|---|
| `useCurrencyFormat` | `hooks/useCurrencyFormat.ts` | Formats raw numbers into localized currency representations with symbols (e.g. `$10,000`, `KES 1,300,000`). |
| `useCurrencyConversion` | `hooks/useCurrencyConversion.ts` | Converts amounts between USD and African fiat currencies (KES, NGN, GHS, TZS) using live or fallback rates. |
| `useDateFormat` | `hooks/useDateFormat.ts` | Formats ISO timestamps into relative ("2 hours ago") or absolute localized formats. |
| `useNumberFormat` | `hooks/useNumberFormat.ts` | Formats percentages (e.g. `12.5%`), tons, or metric units. |
| `useNetworkStatus` / `useOnline` | `hooks/useNetworkStatus.ts` | Monitors online/offline network transitions and displays connectivity banners. |
| `usePushNotifications` | `hooks/usePushNotifications.ts` | Manages Web Push API permissions and VAPID subscription keys. |
| `useStellarWallet` / `useWallet` | `hooks/useStellarWallet.ts` | Manages Freighter, Albedo, and secret key wallet connectivity, account balance, and transaction signing. |
| `useDashboardData` | `hooks/useDashboardData.ts` | SWR-like cached data fetcher for deal portfolios, active investments, and milestone progress. |
| `useTransactionProgress` | `hooks/useTransactionProgress.ts` | Tracks step-by-step progress of multi-operation blockchain transactions (Create -> Sign -> Submit -> Confirm). |
| `useWasmSupport` | `hooks/useWasmSupport.ts` | Detects WebAssembly environment support required for client-side Soroban smart contract interactions. |

### Hook Usage Example: `useCurrencyFormat`
```tsx
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';

export function DealValuationBadge({ totalValue }) {
  const { formatCurrency } = useCurrencyFormat();

  return (
    <span className="font-semibold text-emerald-700">
      {formatCurrency(totalValue, { currency: 'USD', maximumFractionDigits: 0 })}
    </span>
  );
}
```

---

## 5. API Client Patterns (`lib/api.ts`)

All communication with the backend API is routed through [`frontend/src/lib/api.ts`](../src/lib/api.ts). It enforces standardized request patterns:

### 1. Authenticated Calls (`apiFetch`)
Automatically injects the stored JWT `Bearer` token from `localStorage` and handles `401 Unauthorized` responses by redirecting to login:
```ts
export async function getMyInvestments(): Promise<Investment[]> {
  const raw = await apiFetch<any[]>('/users/me/investments');
  return raw.map(normalizeInvestment);
}
```

### 2. Public Calls (`apiFetchPublic`)
Used for unauthenticated marketplace browsing, landing pages, and activity tickers without sending authorization headers:
```ts
export async function getActivityFeed(dealId: string): Promise<ActivityEvent[]> {
  return apiFetchPublic<ActivityEvent[]>(`/trade-deals/${dealId}/activity`);
}
```

### 3. Data Normalization
Backend responses may serialize property names in camelCase or snake_case depending on entity mappings. Normalization helpers ensure that frontend components always receive consistent camelCase interfaces:
```ts
function normalizeDeal(deal: any): Deal {
  return {
    id: deal.id,
    title: deal.title ?? deal.commodity,
    quantity: Number(deal.quantity ?? 0),
    totalValue: Number(deal.total_value ?? deal.totalValue ?? 0),
    tokenCount: Number(deal.token_count ?? deal.tokenCount ?? 0),
    status: deal.status,
    deliveryDate: deal.delivery_date ?? deal.deliveryDate,
    milestones: deal.milestones ?? [],
    documents: deal.documents ?? [],
  };
}
```

---

## 6. When to Add Components to `components/ui/`

Follow this decision checklist before creating or moving a component into `components/ui/`:

| Question | If YES | If NO |
|---|---|---|
| Does the component have zero business domain knowledge (no "deals", "farms", "investments")? | ✅ Candidate for `components/ui/` | ❌ Place in `components/deals/` or `components/marketplace/` |
| Is it reusable across at least two distinct user personas (farmer, trader, investor)? | ✅ Add to `components/ui/` | ❌ Keep scoped to specific feature directory |
| Does it handle only generic user interactions (input, selection, confirmation dialog, tooltip)? | ✅ Add to `components/ui/` | ❌ Create a compound feature component |

---

## 7. Contributing Guidelines for `components/ui/`

When adding or updating a UI primitive:
1. **Forward Ref**: Support `React.forwardRef` where DOM element access is standard (inputs, buttons, modal triggers).
2. **Prop Extension**: Extend standard HTML element interfaces (e.g. `interface InputProps extends React.InputHTMLAttributes<HTMLInputElement>`).
3. **Class Merging**: Use `clsx` or `twMerge` when combining custom `className` props with default Tailwind styles to prevent specificity bugs.
4. **Unit Testing**: Add a corresponding Vitest + React Testing Library test in `components/__tests__/ComponentName.test.tsx` verifying:
   - Renders correctly with default props.
   - Triggers callbacks (`onChange`, `onClick`, `onClose`).
   - Displays error states when `error` prop is set.
   - Accessible roles and keyboard event handling.
