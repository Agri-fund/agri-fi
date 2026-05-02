type Status = 'draft' | 'open' | 'funded' | 'delivered' | 'completed' | 'failed' | 'cancelled' | string;

const cls: Record<string, string> = {
  draft:     'badge-gray',
  open:      'badge-green',
  funded:    'badge-blue',
  delivered: 'badge-purple',
  completed: 'badge-gray',
  failed:    'badge-red',
  cancelled: 'badge-red',
};

export default function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`${cls[status] ?? 'badge-gray'} capitalize`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70 inline-block mr-1" />
      {status}
    </span>
  );
}
