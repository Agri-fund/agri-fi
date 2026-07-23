function CardSkeleton() {
  return (
    <div className="card overflow-hidden">
      <div className="h-1.5 skeleton" />
      <div className="p-5 space-y-4">
        <div className="flex justify-between">
          <div className="skeleton h-5 w-32 rounded-lg" />
          <div className="skeleton h-5 w-16 rounded-full" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-14 rounded-xl" />
          ))}
        </div>
        <div className="skeleton h-8 rounded-xl" />
        <div className="skeleton h-9 rounded-xl" />
      </div>
    </div>
  );
}

const DEFAULT_SKELETON_COUNT = 6;

export default function MarketplaceSkeleton({
  count = DEFAULT_SKELETON_COUNT,
}: { count?: number } = {}) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

export { CardSkeleton };
