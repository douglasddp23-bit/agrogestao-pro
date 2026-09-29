import React from 'react';

interface SkeletonListProps {
  variant?: 'table' | 'cards' | 'list';
  count?: number;
}

export default function SkeletonList({ variant = 'table', count = 5 }: SkeletonListProps) {
  if (variant === 'cards') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse" id="skeleton-cards">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="bg-slate-900/40 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex justify-between items-start">
              <div className="h-6 w-1/2 bg-slate-800 rounded"></div>
              <div className="h-5 w-16 bg-slate-800 rounded-full"></div>
            </div>
            <div className="space-y-2">
              <div className="h-4 w-5/6 bg-slate-800 rounded"></div>
              <div className="h-4 w-2/3 bg-slate-800 rounded"></div>
            </div>
            <div className="pt-4 border-t border-slate-800 flex justify-between">
              <div className="h-4 w-24 bg-slate-800 rounded"></div>
              <div className="h-4 w-16 bg-slate-800 rounded"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'list') {
    return (
      <div className="space-y-4 animate-pulse" id="skeleton-list">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center justify-between p-4 bg-slate-900/20 border border-slate-800 rounded-xl">
            <div className="flex items-center space-x-4 w-full">
              <div className="h-10 w-10 bg-slate-800 rounded-lg shrink-0"></div>
              <div className="space-y-2 w-full max-w-[200px]">
                <div className="h-4 w-full bg-slate-800 rounded"></div>
                <div className="h-3 w-5/6 bg-slate-800 rounded"></div>
              </div>
            </div>
            <div className="h-6 w-20 bg-slate-800 rounded-full"></div>
          </div>
        ))}
      </div>
    );
  }

  // Default: Table skeleton
  return (
    <div className="border border-slate-800 bg-slate-950/40 rounded-xl overflow-hidden animate-pulse animate-duration-1000" id="skeleton-table">
      <div className="bg-slate-900/60 h-12 px-6 flex items-center border-b border-slate-800">
        <div className="grid grid-cols-4 w-full gap-4">
          <div className="h-4 bg-slate-800 rounded w-1/2"></div>
          <div className="h-4 bg-slate-800 rounded w-1/3"></div>
          <div className="h-4 bg-slate-800 rounded w-1/4"></div>
          <div className="h-4 bg-slate-800 rounded w-1/4"></div>
        </div>
      </div>
      <div className="divide-y divide-slate-800">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="h-14 px-6 flex items-center">
            <div className="grid grid-cols-4 w-full gap-4">
              <div className="h-4 bg-slate-800 rounded w-3/4"></div>
              <div className="h-4 bg-slate-800 rounded w-2/3"></div>
              <div className="h-4 bg-slate-800 rounded w-1/2"></div>
              <div className="h-4 bg-slate-800 rounded w-1/3"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
