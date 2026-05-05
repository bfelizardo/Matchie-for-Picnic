import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { UserPlus, Trash2, Shield, User as UserIcon, Loader2, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from '../lib/firebaseUtils';

export function UserManagement({ currentUserEmail, onClose }: { currentUserEmail: string, onClose: () => void }) {
  const [users, setUsers] = useState<any[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'app_users'));
    return onSnapshot(q, (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'app_users');
    });
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || !newEmail.includes('@')) return;
    
    try {
      await setDoc(doc(db, 'app_users', newEmail.trim().toLowerCase()), {
        email: newEmail.trim().toLowerCase(),
        role: 'member',
        addedBy: currentUserEmail,
        addedAt: serverTimestamp()
      });
      setNewEmail('');
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'app_users');
    }
  };

  const handleRemove = async (email: string) => {
    if (email === currentUserEmail) {
      alert("You cannot remove yourself.");
      return;
    }
    if (confirm(`Remove ${email} from accessing Matchie?`)) {
      try {
        await deleteDoc(doc(db, 'app_users', email));
      } catch (e) {
        handleFirestoreError(e, OperationType.DELETE, `app_users/${email}`);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-xl bg-slate-50 rounded-[32px] lg:rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] lg:max-h-[85vh] border border-white/20"
      >
        {loading ? (
          <div className="flex flex-col items-center justify-center p-20 gap-4">
            <Loader2 className="w-10 h-10 animate-spin text-rose-500" />
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Loading Family List</span>
          </div>
        ) : (
          <>
            <div className="p-6 lg:p-10 relative bg-white border-b border-slate-100">
              <button 
                onClick={onClose}
                className="absolute right-4 top-4 lg:right-6 lg:top-6 p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-800 rounded-xl transition-all active:scale-90"
              >
                <X className="w-6 h-6" />
              </button>
              <div className="flex items-center gap-4">
                <div className="bg-rose-500 p-3 rounded-2xl text-white shadow-lg shadow-rose-200 shrink-0">
                  <Shield className="w-6 h-6 lg:w-7 lg:h-7" />
                </div>
                <div>
                  <h2 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-none">Family Access</h2>
                  <p className="text-[10px] lg:text-xs font-bold text-slate-400 uppercase tracking-widest mt-1.5">Manage Shared Authority</p>
                </div>
              </div>
            </div>

            <div className="p-6 lg:p-10 pb-6 pt-6 bg-slate-50">
              <form onSubmit={handleInvite} className="flex gap-2 lg:gap-3 relative">
                <div className="relative flex-1">
                  <input 
                    type="email" 
                    placeholder="Email address..." 
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full pl-11 pr-4 py-3.5 rounded-2xl border border-slate-200 text-sm focus:ring-4 focus:ring-rose-500/10 focus:border-rose-500 outline-none transition-all shadow-sm bg-white font-medium"
                  />
                  <UserPlus className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                </div>
                <button 
                  type="submit" 
                  disabled={!newEmail.trim() || !newEmail.includes('@')}
                  className={cn(
                    "px-6 py-3.5 bg-rose-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-rose-200 hover:bg-rose-700 disabled:opacity-50 transition-all active:scale-95",
                    !newEmail.trim() || !newEmail.includes('@') ? "cursor-not-allowed" : "cursor-pointer"
                  )}
                >
                  Invite
                </button>
              </form>
            </div>

            <div className="flex-1 overflow-y-auto p-6 lg:p-10 pt-0 bg-slate-50">
              <div className="bg-white border border-slate-200 rounded-[24px] lg:rounded-[32px] shadow-sm overflow-hidden flex flex-col">
                <div className="flex items-center justify-between bg-slate-50/50 border-b border-slate-100 p-4 px-6">
                   <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Team Members</h3>
                   <span className="text-[10px] font-bold text-slate-400">{users.length} Active</span>
                </div>
                
                <div className="divide-y divide-slate-50">
                  <AnimatePresence mode="popLayout text-xs font-bold">
                    {users.map(u => (
                      <motion.div 
                        key={u.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="flex flex-col xs:flex-row xs:items-center justify-between p-5 lg:p-6 hover:bg-slate-50/30 transition-colors group gap-4"
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <div className={cn(
                            "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border shadow-sm transition-all group-hover:scale-105",
                            u.role === 'admin' ? "bg-white border-rose-100 text-rose-500" : "bg-white border-slate-100 text-slate-400"
                          )}>
                            {u.role === 'admin' ? <Shield className="w-5 h-5" /> : <UserIcon className="w-5 h-5" />}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-black text-slate-800 truncate tracking-tight">{u.email}</div>
                            {u.email === currentUserEmail ? (
                              <span className="text-[9px] font-black uppercase tracking-widest text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded-full">Primary Account Holder</span>
                            ) : (
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight italic">Family Member</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between xs:justify-end gap-3 self-stretch xs:self-auto border-t xs:border-t-0 pt-3 xs:pt-0 border-slate-50">
                          <span className={cn(
                            "px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border",
                            u.role === 'admin' ? "bg-rose-50 border-rose-100 text-rose-600" : "bg-slate-100 border-slate-200 text-slate-500"
                          )}>
                            {u.role}
                          </span>
                          
                          {u.role !== 'admin' && (
                            <button 
                              onClick={() => handleRemove(u.email)}
                              className="p-2.5 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all active:scale-90 cursor-pointer"
                              title="Revoke and delete access"
                            >
                              <Trash2 className="w-4.5 h-4.5" />
                            </button>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {users.length === 0 && (
                    <div className="p-12 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest italic">Grid System Empty</div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
