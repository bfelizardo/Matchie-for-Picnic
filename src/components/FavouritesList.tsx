import React, { useState } from 'react';
import { Sparkles, Search, ShoppingBasket, RefreshCw, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { PicnicProduct } from '../lib/gemini';
import { cn } from '../lib/utils';

interface FavouritesListProps {
  favourites: PicnicProduct[];
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function FavouritesList({ favourites, onRefresh, refreshing }: FavouritesListProps) {
  const [search, setSearch] = useState('');

  const filteredFavourites = favourites.filter(f => 
    (f.name || "").toLowerCase().includes((search || "").toLowerCase())
  );

  const formatPrice = (cents?: number) => {
    if (typeof cents !== 'number') return '0.00';
    return (cents / 100).toFixed(2);
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden h-full flex flex-col">
      <div className="p-4 lg:p-6 border-b border-slate-100 bg-purple-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 lg:w-14 lg:h-14 rounded-2xl bg-purple-600 text-white flex items-center justify-center shadow-lg shadow-purple-200 shrink-0">
            <Sparkles className="w-7 h-7 lg:w-8 lg:h-8" />
          </div>
          <div>
            <h2 className="font-black text-slate-900 text-lg lg:text-xl tracking-tight leading-tight">Picnic Favourites</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-purple-600 font-black uppercase tracking-widest bg-purple-100 px-1.5 py-0.5 rounded">Reference data</span>
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">• {favourites.length} Items</span>
            </div>
          </div>
        </div>
        
        <div className="flex flex-col xs:flex-row items-stretch xs:items-center gap-3">
          <div className="relative flex-1 xs:flex-none">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text"
              placeholder="Search catalogue..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 w-full sm:w-64 transition-all shadow-sm"
            />
          </div>
          {onRefresh && (
            <button 
              onClick={onRefresh}
              disabled={refreshing}
              className={cn(
                "h-[42px] flex items-center justify-center gap-2 px-5 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] text-purple-600 hover:bg-purple-50 hover:border-purple-200 shadow-sm transition-all disabled:opacity-50 active:scale-95 whitespace-nowrap",
                refreshing ? "cursor-not-allowed" : "cursor-pointer"
              )}
            >
              <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
              <span>{refreshing ? 'Syncing' : 'Pull Favourites'}</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 lg:p-6 custom-scrollbar bg-slate-50/50">
        {filteredFavourites.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center shadow-sm mb-6 border border-slate-100">
              <Sparkles className="w-10 h-10 text-slate-200" />
            </div>
            <h3 className="text-sm font-bold text-slate-600 uppercase tracking-widest mb-2 italic">Product Favourites Empty</h3>
            <p className="text-xs text-slate-400 max-w-[280px]">
              {search ? "No matches found for your search query." : "Connect your Picnic account to pull your favourites and frequently bought items."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 lg:gap-4">
            {Array.from(new Map(filteredFavourites.map(p => [p.id, p])).values()).map((product) => (
              <motion.div
                key={product.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white p-3 lg:p-4 rounded-2xl border border-slate-200 shadow-sm hover:border-purple-300 hover:shadow-md hover:shadow-purple-50 transition-all flex flex-col group relative overflow-hidden"
              >
                <div className="aspect-square bg-white rounded-xl flex items-center justify-center overflow-hidden mb-3 relative group-hover:scale-105 transition-transform duration-500">
                  {product.image ? (
                    <img src={product.image} alt={product.name} className="w-full h-full object-contain p-2" referrerPolicy="no-referrer" />
                  ) : (
                    <ShoppingBasket className="w-8 h-8 text-slate-100" />
                  )}
                </div>
                
                <div className="flex flex-col gap-1.5 min-h-[40px]">
                  <h3 className="font-bold text-slate-900 text-xs leading-tight line-clamp-2 uppercase tracking-tight group-hover:text-purple-600 transition-colors" title={product.name}>
                    {product.name}
                  </h3>
                  {product.unit_quantity || product.unit_name ? (
                    <div className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">
                      {product.unit_quantity} {product.unit_name ? `(${product.unit_name})` : ''}
                    </div>
                  ) : null}
                </div>
                
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-50">
                  <div className="flex flex-col">
                    <p className="text-xs font-black text-slate-900">€{formatPrice(product.price)}</p>
                    {product.price_per_unit_text && (
                      <p className="text-[8px] text-slate-400 font-bold uppercase tracking-tighter mt-0.5">{product.price_per_unit_text}</p>
                    )}
                  </div>
                  <button 
                    onClick={() => {
                        const event = new CustomEvent('add-favourite', { detail: product });
                        window.dispatchEvent(event);
                    }}
                    className="p-2 transition-all text-purple-600 hover:bg-purple-50 rounded-xl cursor-pointer active:scale-90"
                    title="Add to shopping list"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
