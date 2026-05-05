import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Brain, Trash2, Edit2, Search, X, Check, 
  Save, Plus, ShoppingBasket, ChevronRight,
  ArrowRight, Hash, Tag, Trash, Sparkles, Loader2,
  AlertCircle, RefreshCw
} from 'lucide-react';
import type { PicnicProduct } from '../lib/gemini';
import { cn } from '../lib/utils';
import { picnicApi } from '../lib/picnic';

interface MemoryManagerProps {
  preferences: Record<string, any>;
  onUpdateMemory: (term: string, product: PicnicProduct | null) => Promise<void>;
  onBatchUpdateMemory: (updates: Array<{ term: string, product: PicnicProduct | null }>) => Promise<void>;
  onRunAiMatchMemory: (terms: string[], forceReview?: boolean) => Promise<any>;
  onReviewCandidates: (term: string, candidates: PicnicProduct[]) => void;
  onSelectProduct: (term: string, currentTerms: string[]) => void;
  onSyncMemory?: () => Promise<void>;
  syncing?: boolean;
  favourites: PicnicProduct[];
  picnicToken: string | null;
}

interface GroupedMemory {
  productId: string;
  product: PicnicProduct;
  terms: string[];
}

const formatPrice = (price: any) => {
  if (typeof price === 'number') return (price / 100).toFixed(2);
  if (typeof price === 'string') {
    // If it's already a formatted price (e.g. "2.49" or "€2.49"), try to extract the number
    const numeric = price.replace(/[^\d.,]/g, '').replace(',', '.');
    return parseFloat(numeric).toFixed(2);
  }
  return "0.00";
};

export const MemoryManager: React.FC<MemoryManagerProps> = ({ 
  preferences, 
  onUpdateMemory,
  onBatchUpdateMemory,
  onRunAiMatchMemory,
  onReviewCandidates,
  onSelectProduct,
  onSyncMemory,
  syncing,
  favourites,
  picnicToken
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [newTermInput, setNewTermInput] = useState('');
  const [aiMatchingGroup, setAiMatchingGroup] = useState<string | null>(null);
  const [termToDelete, setTermToDelete] = useState<{term: string, totalTerms: number} | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<GroupedMemory | null>(null);

  // Group terms by product
  const groupedMemories = useMemo(() => {
    const groups: Record<string, GroupedMemory> = {};
    
    Object.entries(preferences).forEach(([term, dataValue]) => {
      const data = dataValue as any;
      let product: PicnicProduct | null = null;
      if (typeof data === 'object' && data !== null) {
        // Handle migration/legacy where pastMatches contained MatchResult instead of PicnicProduct
        if ('product' in data && data.product && data.product.id) {
          product = data.product as PicnicProduct;
        } else if (data.id) {
          product = data as PicnicProduct;
        }
      } else if (typeof data === 'string') {
        product = favourites.find(f => f.id === data) || null;
      }
      
      if (!product || !product.id) return;

      if (!groups[product.id]) {
        groups[product.id] = {
          productId: product.id,
          product,
          terms: []
        };
      }
      groups[product.id].terms.push(term);
    });

    return Object.values(groups).sort((a, b) => (a.product?.name || "").localeCompare(b.product?.name || ""));
  }, [preferences, favourites]);

  const filteredGroups = groupedMemories.filter(group => 
    (group.product?.name || "").toLowerCase().includes((searchQuery || "").toLowerCase()) ||
    group.terms.some(t => (t || "").toLowerCase().includes((searchQuery || "").toLowerCase()))
  );

  const activeGroup = groupedMemories.find(g => g.productId === editingGroupId);

  const pendingCandidates = useMemo(() => {
    const pending: {term: string, candidates: PicnicProduct[]}[] = [];
    Object.entries(preferences).forEach(([term, dataValue]) => {
      const data = dataValue as any;
      if (typeof data === 'object' && data !== null) {
        const hasProduct = !!(data.product || data.id);
        if (!hasProduct) {
          pending.push({ 
            term, 
            candidates: (data.candidates as PicnicProduct[]) || [] 
          });
        }
      }
    });
    return pending;
  }, [preferences]);

  const handleAddTerm = async (productId: string, product: PicnicProduct) => {
    if (!newTermInput.trim()) return;
    const term = newTermInput.trim().toLowerCase();
    try {
      await onUpdateMemory(term, product);
      setNewTermInput('');
    } catch (error) {
      console.error("Failed to add term", error);
    }
  };

  const handleRemoveTerm = async (term: string, totalTerms: number) => {
    if (totalTerms === 1) {
      setTermToDelete({ term, totalTerms });
    } else {
      await onUpdateMemory(term, null);
    }
  };

  const confirmRemoveTerm = async () => {
    if (termToDelete) {
      await onUpdateMemory(termToDelete.term, null);
      setTermToDelete(null);
    }
  };

  const handleRemoveGroup = async (group: GroupedMemory) => {
    setGroupToDelete(group);
  };

  const confirmRemoveGroup = async () => {
    if (groupToDelete) {
      const updates = groupToDelete.terms.map(term => ({ term, product: null }));
      await onBatchUpdateMemory(updates);
      setGroupToDelete(null);
      setEditingGroupId(null);
    }
  };

  const handleAiMatchGroup = async (group: GroupedMemory) => {
    setAiMatchingGroup(group.productId);
    try {
      const results = await onRunAiMatchMemory(group.terms, true);
      
      // If no matches or candidates were found at all for any term, 
      // let's notify the user via a simple alert
      const hasAnyResults = results && Object.values(results).some((r: any) => r && (r.product || (r.candidates && r.candidates.length > 0)));
      
      if (!hasAnyResults) {
        alert(`AI couldn't find any direct matches for: ${group.terms.join(", ")}. These have been moved to the Review section for manual mapping.`);
      }
    } finally {
      setAiMatchingGroup(null);
      setEditingGroupId(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-full flex flex-col" id="memory-manager">
      {/* Header */}
      <div className="p-4 lg:p-6 border-b border-slate-100 bg-amber-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 lg:w-14 lg:h-14 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-lg shadow-amber-200 shrink-0">
            <Brain className="w-7 h-7 lg:w-8 lg:h-8" />
          </div>
          <div>
            <h2 className="font-black text-slate-900 text-lg lg:text-xl tracking-tight leading-tight">Matching Brain</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-amber-600 font-black uppercase tracking-widest bg-amber-100 px-1.5 py-0.5 rounded">Learning Active</span>
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">• {groupedMemories.length} Patterns</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col xs:flex-row items-stretch xs:items-center gap-3">
          <div className="relative flex-1 xs:flex-none">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text"
              placeholder="Search triggers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 w-full sm:w-64 transition-all shadow-sm"
            />
          </div>
          {onSyncMemory && (
            <button 
              onClick={onSyncMemory}
              disabled={syncing}
              className={cn(
                "h-[42px] flex items-center justify-center gap-2 px-5 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] text-amber-600 hover:bg-amber-50 hover:border-amber-200 shadow-sm transition-all disabled:opacity-50 active:scale-95 whitespace-nowrap",
                syncing ? "cursor-not-allowed" : "cursor-pointer"
              )}
              title="Synchronize memory changes with the cloud"
            >
              <RefreshCw className={cn("w-4 h-4", syncing && "animate-spin")} />
              <span>{syncing ? 'Syncing' : 'Update'}</span>
            </button>
          )}
        </div>
      </div>
      
      <div className="bg-amber-100/30 border-b border-amber-200/50 px-6 py-2">
         <p className="text-[10px] text-amber-700 font-medium italic">Click "Update" above if you've recently modified matches to ensure AI learns your new preferences.</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-slate-50/50">
        <div className="grid gap-4 mb-4">
          {pendingCandidates.map(({term, candidates}) => (
            <div key={`pending-${term}`} className="bg-purple-50/50 border border-purple-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-100/50 flex items-center justify-center text-purple-600 shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-sm leading-tight">Review "{term}"</h3>
                  <p className="text-xs text-purple-700 mt-0.5">
                    {candidates.length > 0 
                      ? `${candidates.length} potential matches to review` 
                      : "No certain match found by AI"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-stretch sm:self-auto">
                <button 
                  onClick={() => onUpdateMemory(term, null)}
                  className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors shrink-0 border border-transparent cursor-pointer"
                  title="Forget this term"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => {
                    if (candidates.length > 0) {
                      onReviewCandidates(term, candidates);
                    } else {
                      onSelectProduct(term, [term]);
                    }
                  }}
                  className={cn(
                    "flex-1 sm:flex-none px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white border border-transparent rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2 whitespace-nowrap active:scale-95",
                    "cursor-pointer"
                  )}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {candidates.length > 0 ? 'Select Best Fit' : 'Manual Match'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {filteredGroups.length === 0 && pendingCandidates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Brain className="w-16 h-16 mb-4 opacity-5" />
            <p className="text-sm font-medium">No memory patterns found</p>
            <p className="text-xs max-w-[200px] text-center mt-1">Manual matches are saved here to improve AI recognition next time.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredGroups.map((group) => (
              <motion.div 
                key={group.productId}
                initial={false}
                className={cn(
                  "bg-white border rounded-2xl overflow-hidden self-start transition-shadow duration-300",
                  editingGroupId === group.productId ? "border-amber-500 shadow-xl ring-1 ring-amber-500/20" : "border-slate-200 hover:border-slate-300 shadow-sm"
                )}
              >
                {/* Product Header */}
                <div className="p-4 flex items-center justify-between bg-white border-b border-slate-50">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-16 h-16 bg-white border border-slate-100 rounded-2xl flex items-center justify-center overflow-hidden shrink-0 shadow-sm group-hover:scale-105 transition-transform">
                      <img 
                        src={group.product.image} 
                        alt="" 
                        className="w-full h-full object-contain p-2"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-slate-900 text-sm lg:text-base leading-tight truncate">{group.product.name}</h3>
                      <div className="flex flex-wrap items-center gap-3 mt-1.5">
                        <p className="text-[11px] font-black text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded">€{formatPrice(group.product.price)}</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                          {group.product.unit_quantity ? <span>{group.product.unit_quantity} </span> : null}
                          {group.product.unit_name ? <span>({group.product.unit_name})</span> : null}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 shrink-0">
                    <button 
                      onClick={() => setEditingGroupId(editingGroupId === group.productId ? null : group.productId)}
                      className={cn(
                        "w-10 h-10 lg:w-auto lg:px-4 lg:py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.1em] transition-all flex items-center justify-center gap-2 border shadow-sm active:scale-95 cursor-pointer",
                        editingGroupId === group.productId 
                          ? "bg-slate-800 border-slate-800 text-white hover:bg-slate-900" 
                          : "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
                      )}
                    >
                      {editingGroupId === group.productId ? <X className="w-4 h-4" /> : <Edit2 className="w-4 h-4 border-amber-300" />}
                      <span className="hidden lg:inline">{editingGroupId === group.productId ? "Close" : "Manage Triggers"}</span>
                    </button>
                  </div>
                </div>

                {/* Terms Section */}
                <div className="p-4 bg-slate-50/30">
                  <div className="flex items-center gap-2 mb-3">
                    <Tag className="w-3 h-3 text-slate-400" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Learned Match Triggers</span>
                  </div>
                  
                  <div className="flex flex-wrap gap-2">
                    {group.terms.map(term => (
                      <div 
                        key={term}
                        className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-full group/term hover:border-amber-200 hover:bg-amber-50/50 transition-all"
                      >
                        <span className="text-xs font-medium text-slate-700">"{term}"</span>
                        {editingGroupId === group.productId && (
                          <button 
                            onClick={() => handleRemoveTerm(term, group.terms.length)}
                            className="p-0.5 hover:bg-amber-100 hover:text-amber-600 rounded-full text-slate-400 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                    
                    {editingGroupId === group.productId ? (
                      <div className="relative group/add flex items-center">
                        <input 
                          type="text"
                          placeholder="Add new term..."
                          value={newTermInput}
                          onChange={(e) => setNewTermInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddTerm(group.productId, group.product)}
                          className="pl-3 pr-8 py-1.5 bg-white border border-dashed border-amber-300 rounded-full text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/20 w-32 focus:w-48 transition-all"
                        />
                        <button 
                          type="button"
                          onClick={() => handleAddTerm(group.productId, group.product)}
                          className="absolute right-1 p-1.5 bg-amber-500 text-white rounded-full hover:bg-amber-600 shadow-sm transition-colors z-10 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 px-3 py-1.5 text-slate-400 italic text-[10px] font-medium">
                        Learned Patterns: {group.terms.length}
                      </div>
                    )}
                  </div>

                  <AnimatePresence>
                    {editingGroupId === group.productId && (
                      <motion.div 
                        key={`edit-section-${group.productId}`}
                        initial={{ opacity: 0, height: 0 }} 
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-6 pt-4 border-t border-slate-100">
                          <div className="flex flex-col sm:flex-row items-center justify-between mb-4 gap-3">
                            <div className="flex items-center gap-2 self-start sm:self-auto">
                              <ArrowRight className="w-3 h-3 text-amber-500" />
                              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-800">Remap all terms to:</span>
                            </div>
                            <div className="flex items-center gap-2 self-stretch sm:self-auto">
                              <button 
                                onClick={() => handleAiMatchGroup(group)}
                                disabled={aiMatchingGroup === group.productId}
                                className="flex-1 sm:flex-none px-4 py-2 bg-purple-50 border border-purple-100 rounded-xl text-xs font-bold text-purple-600 hover:bg-purple-100 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                              >
                                {aiMatchingGroup === group.productId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                AI Match
                              </button>
                              <button 
                                onClick={() => onSelectProduct(group.product.name, group.terms)}
                                className="flex-[2] sm:flex-none px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
                              >
                                <ShoppingBasket className="w-3.5 h-3.5 text-amber-500" />
                                Select Product
                              </button>
                            </div>
                          </div>

                          <div className="flex items-center justify-between p-3 bg-white/50 rounded-xl border border-dashed border-slate-200">
                             <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
                                  <Brain className="w-4 h-4" />
                                </div>
                                <span className="text-[10px] text-slate-500">All matching logic for these {group.terms.length} terms will be updated.</span>
                             </div>
                             <button 
                               onClick={() => handleRemoveGroup(group)}
                               className="p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                               title="Delete entire pattern"
                             >
                               <Trash2 className="w-4 h-4" />
                             </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {termToDelete && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
              onClick={() => setTermToDelete(null)}
            />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-xl bg-white rounded-[32px] shadow-2xl overflow-hidden border border-slate-100 flex flex-col"
            >
              <div className="p-8">
                <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mb-4">
                  <Trash2 className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">Delete Last Term?</h3>
                <p className="text-sm text-slate-600">
                   Are you sure you want to delete <span className="font-bold">"{termToDelete.term}"</span>?
                </p>
                <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800">
                    This is the last term in this group. Deleting it will completely remove this matched item from its learned patterns.
                  </p>
                </div>
              </div>
              
              <div className="p-8 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
                <button 
                  onClick={() => setTermToDelete(null)}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 hover:text-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmRemoveTerm}
                  className="px-4 py-2 rounded-xl text-sm font-bold bg-amber-500 text-white hover:bg-amber-600 shadow-sm transition-colors"
                >
                  Delete Match
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Group Deletion Confirmation */}
      <AnimatePresence>
        {groupToDelete && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
              onClick={() => setGroupToDelete(null)}
            />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-xl bg-white rounded-[32px] shadow-2xl overflow-hidden border border-slate-100 flex flex-col"
            >
              <div className="p-8">
                <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mb-4">
                  <Trash2 className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">Delete Entire Pattern?</h3>
                <p className="text-sm text-slate-600">
                   This will remove all <span className="font-bold underline">{groupToDelete.terms.length} triggers</span> that point to <span className="font-bold">"{groupToDelete.product.name}"</span>.
                </p>
                <div className="mt-4 flex flex-wrap gap-2 opacity-60">
                  {groupToDelete.terms.map(t => (
                    <span key={t} className="px-3 py-1 bg-slate-100 rounded-full text-[10px] font-bold text-slate-500">"{t}"</span>
                  ))}
                </div>
              </div>
              
              <div className="p-8 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
                <button 
                  onClick={() => setGroupToDelete(null)}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmRemoveGroup}
                  className="px-4 py-2 rounded-xl text-sm font-bold bg-rose-600 text-white hover:bg-rose-700 shadow-sm transition-colors"
                >
                  Delete Entire Pattern
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

