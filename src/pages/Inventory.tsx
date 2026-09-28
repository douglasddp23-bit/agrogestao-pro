import React, { useState, useEffect, useRef } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { 
  Boxes, 
  PlusCircle, 
  ArrowUp, 
  ArrowDown, 
  AlertTriangle, 
  Trash2, 
  History, 
  Search, 
  Filter, 
  Calendar, 
  User, 
  Package, 
  ArrowLeftRight, 
  FileSpreadsheet, 
  FileText,
  Bookmark,
  ChevronRight,
  ScanBarcode,
  QrCode,
  Camera,
  X,
  CheckCircle2,
  FileCheck
} from 'lucide-react';
import { collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc, writeBatch, query, orderBy, increment } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import { exportToExcel } from '../lib/exportExcel';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import SkeletonList from '../components/SkeletonList';
import { formatDateTime, formatDate, cn, formatCurrency } from '../lib/utils';
import ConfirmationModal from '../components/ConfirmationModal';
import { PERMISSIONS } from '../lib/permissions';
import { UserRole } from '../types';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { Package as PageIcon } from 'lucide-react';

interface InventoryItemState {
  id: string;
  name: string;
  category: string;
  unit: string;
  currentQuantity: number;
  minQuantity: number;
  supplier: string;
  unitCost: number;
  barcode?: string;
  lotNumber?: string;
  expiryDate?: string;
  createdAt: string;
  updatedAt: string;
}

interface NewItemForm {
  name: string;
  category: string;
  unit: string;
  currentQuantity: string;
  minQuantity: string;
  supplier: string;
  unitCost: string;
  barcode?: string;
  lotNumber?: string;
  expiryDate?: string;
}

interface NewMovementForm {
  itemId: string;
  type: 'in' | 'out';
  quantity: string;
  reason: string;
  lotNumber?: string;
  recipeNumber?: string;
}

export default function Inventory() {
  const { user } = useAuth();
  const role = (user?.effectiveRole ?? user?.role) as UserRole;
  const canPrice = PERMISSIONS.canEditPrice(role);

  const [activeTab, setActiveTab] = useState<'items' | 'movements'>('items');
  const [loading, setLoading] = useState(true);
  
  // States
  const [items, setItems] = useState<InventoryItemState[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  
  // Search & Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [stockStatusFilter, setStockStatusFilter] = useState('all');

  // Modals
  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);
  const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);
  const [selectedItemForMovement, setSelectedItemForMovement] = useState<InventoryItemState | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<string | null>(null);
  const [isScannerModalOpen, setIsScannerModalOpen] = useState(false);
  const [scannedCodeInput, setScannedCodeInput] = useState('');

  // Forms
  const [itemForm, setItemForm] = useState<NewItemForm>({
    name: '',
    category: 'ferramentas',
    unit: 'unidades',
    currentQuantity: '',
    minQuantity: '',
    supplier: '',
    unitCost: '',
    barcode: '',
    lotNumber: ''
  });

  const [movementForm, setMovementForm] = useState<NewMovementForm>({
    itemId: '',
    type: 'out',
    quantity: '',
    reason: 'Uso em campo (Consultoria)',
    lotNumber: '',
    recipeNumber: ''
  });

  const isAuthorized = (user?.effectiveRole ?? user?.role) === 'admin' || (user?.effectiveRole ?? user?.role) === 'manager' || (user?.effectiveRole ?? user?.role) === 'staff' || (user?.effectiveRole ?? user?.role) === 'consultant';
  const isAdmin = (user?.effectiveRole ?? user?.role) === 'admin' || (user?.effectiveRole ?? user?.role) === 'manager';

  // Real-time Listeners
  useEffect(() => {
    const unsubscribeItems = onSnapshot(query(collection(db, 'inventory_items'), orderBy('name', 'asc')), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItemState));
      setItems(data);
      setLoading(false);
    }, (error) => {
      console.error(error);
      toast.error("Erro ao carregar itens do almoxarifado.");
      setLoading(false);
    });

    const unsubscribeMovements = onSnapshot(query(collection(db, 'inventory_movements'), orderBy('createdAt', 'desc')), (snapshot) => {
      setMovements(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubscribeItems();
      unsubscribeMovements();
    };
  }, []);

  // Creation Handler
  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      toast.error("Aparência restrita. Apenas administradores cadastram novos insumos.");
      return;
    }

    const qty = parseFloat(String(itemForm.currentQuantity).replace(',', '.'));
    const min = parseFloat(String(itemForm.minQuantity).replace(',', '.'));
    const cost = parseFloat(itemForm.unitCost.replace(',', '.'));

    if (isNaN(qty) || qty < 0 || isNaN(min) || min < 0 || isNaN(cost) || cost < 0) {
      toast.error("Preencha valores numéricos positivos coerentes.");
      return;
    }

    try {
      const payload = {
        name: itemForm.name,
        category: itemForm.category,
        unit: itemForm.unit,
        currentQuantity: qty,
        minQuantity: min,
        supplier: itemForm.supplier || 'Geral',
        unitCost: cost,
        barcode: itemForm.barcode || null,
        lotNumber: itemForm.lotNumber || null,
        expiryDate: itemForm.expiryDate || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await addDoc(collection(db, 'inventory_items'), payload);
      toast.success(`Insumo "${itemForm.name}" adicionado ao inventário!`);
      setIsAddItemModalOpen(false);
      setItemForm({
        name: '',
        category: 'ferramentas',
        unit: 'unidades',
        currentQuantity: '',
        minQuantity: '',
        supplier: '',
        unitCost: '',
        barcode: '',
        lotNumber: '',
        expiryDate: ''
      });
    } catch (error) {
      console.error(error);
      toast.error("Erro de persistência de insumo no Firestore.");
    }
  };

  // Barcode quick scan / match handler
  const handleQuickBarcodeLookup = (code: string) => {
    const cleanCode = code.trim();
    if (!cleanCode) return;

    const matched = items.find(i => 
      (i.barcode && (i.barcode || '').toLowerCase() === cleanCode.toLowerCase()) ||
      (i.lotNumber && (i.lotNumber || '').toLowerCase() === cleanCode.toLowerCase()) ||
      (i.name || '').toLowerCase().includes(cleanCode.toLowerCase())
    );

    if (matched) {
      toast.success(`Item identificado: ${matched.name} (Saldo: ${matched.currentQuantity} ${matched.unit})`);
      openQuickMovement(matched, 'out');
      setIsScannerModalOpen(false);
      setScannedCodeInput('');
    } else {
      toast.error(`Nenhum item com código "${cleanCode}" encontrado no inventário.`);
    }
  };

  // Movement Handler
  const handleRegisterMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    const itemToMove = selectedItemForMovement || items.find(i => i.id === movementForm.itemId);
    if (!itemToMove) {
      toast.error("Insumo correspondente não localizado.");
      return;
    }

    if (!isAuthorized) {
      toast.error("Operação restrita para colaboradores autorizados.");
      return;
    }

    // Aceita decimais com vírgula ou ponto (ex.: 2,5 L). parseInt cortava "2,5" para 2.
    const qty = parseFloat(String(movementForm.quantity).replace(',', '.'));
    if (isNaN(qty) || qty <= 0) {
      toast.error("Quantidade de movimentação inválida.");
      return;
    }

    if (movementForm.type === 'out' && itemToMove.currentQuantity < qty) {
      toast.error(`Estoque indisponível. Saldo atual: ${itemToMove.currentQuantity} ${itemToMove.unit}.`);
      return;
    }

    try {
      const batch = writeBatch(db);

      // Create Movement record
      const mPayload = {
        itemId: itemToMove.id,
        itemName: itemToMove.name,
        type: movementForm.type,
        quantity: qty,
        reason: movementForm.reason,
        lotNumber: movementForm.lotNumber || itemToMove.lotNumber || null,
        recipeNumber: movementForm.recipeNumber || null,
        responsibleId: user?.uid || 'offline',
        responsibleName: user?.displayName || user?.email || 'Membro do Time',
        createdAt: new Date().toISOString()
      };
      
      const mRef = doc(collection(db, 'inventory_movements'));
      batch.set(mRef, mPayload);

      // Update Item current stock
      const iRef = doc(db, 'inventory_items', itemToMove.id);
      // increment() soma no servidor: duas movimentações simultâneas não se sobrescrevem.
      batch.update(iRef, {
        currentQuantity: increment(movementForm.type === 'in' ? qty : -qty),
        updatedAt: new Date().toISOString()
      });

      await batch.commit();
      toast.success(`${movementForm.type === 'in' ? 'Entrada' : 'Retirada'} de ${qty} ${itemToMove.unit} realizada!`);
      setIsMovementModalOpen(false);
      setSelectedItemForMovement(null);
      setMovementForm({
        itemId: '',
        type: 'out',
        quantity: '',
        reason: 'Uso em campo (Consultoria)'
      });
    } catch (error) {
      console.error(error);
      toast.error("Erro de transação de estoque no banco de dados.");
    }
  };

  const handleDeleteItem = async () => {
    if (!isAdmin) {
      toast.error("Ações destrutivas indisponíveis.");
      return;
    }
    if (!isDeleteModalOpen) return;

    try {
      await deleteDoc(doc(db, 'inventory_items', isDeleteModalOpen));
      toast.success("Insumo físico erradicado do inventário.");
      setIsDeleteModalOpen(null);
    } catch (error) {
      console.error(error);
      toast.error("Erro de deleção de insumo.");
    }
  };

  const openQuickMovement = (item: InventoryItemState, type: 'in' | 'out') => {
    setSelectedItemForMovement(item);
    setMovementForm(prev => ({
      ...prev,
      itemId: item.id,
      type: type
    }));
    setIsMovementModalOpen(true);
  };

  // Process filters
  const filteredItems = items.filter(item => {
    const matchesSearch = (item.name || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (item.supplier || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;
    
    // Status warning filters
    let matchesStatus = true;
    if (stockStatusFilter === 'warning') {
      matchesStatus = item.currentQuantity <= item.minQuantity;
    } else if (stockStatusFilter === 'ok') {
      matchesStatus = item.currentQuantity > item.minQuantity;
    }

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const lowStockCount = items.filter(i => i.currentQuantity <= i.minQuantity).length;
  const totalItemsCount = items.length;

  const handleExportXLSX = () => {
    if (activeTab === 'items') {
      const data = filteredItems.map(i => ({
        "Insumo / Material": i.name,
        "Categoria": (i.category || '').toUpperCase(),
        "Medida": i.unit,
        "Saldo Atual": i.currentQuantity,
        "Estoque Mínimo": i.minQuantity,
        "Status": i.currentQuantity <= i.minQuantity ? 'CRÍTICO' : 'ESTÁVEL',
        "Custo Unitário": `${formatCurrency(i.unitCost)}`,
        "Custo Total": `${formatCurrency((i.currentQuantity * i.unitCost))}`,
        "Fornecedor": i.supplier,
        "Última Atualização": formatDate(i.updatedAt)
      }));
      exportToExcel(data, 'Inventario_Almoxarifado_AgroGestao', 'Estoque');
    } else {
      const data = movements.map(m => ({
        "Insumo": m.itemName,
        "Ação": m.type === 'in' ? 'Entrada (+)' : 'Retirada (-)',
        "Quantidade": m.quantity,
        "Motivo": m.reason,
        "Responsável": m.responsibleName,
        "Registrado Em": formatDateTime(m.createdAt)
      }));
      exportToExcel(data, 'Movimentacoes_Estoque_AgroGestao', 'Historico_Estoque');
    }
    toast.success("Dados do Almoxarifado exportados com sucesso!");
  };

  const handleExportPDF = () => {
    const doc = new jsPDF() as any;
    
    doc.setFillColor(79, 70, 229); // indigo-600 color theme
    doc.rect(0, 0, 210, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(22);
    doc.text("AGROGESTÃO PRO", 15, 20);
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(10);
    doc.text("RELATÓRIO DE BALANÇO DE ALMOXARIFADO", 15, 30);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 145, 30);

    if (activeTab === 'items') {
      const headers = [["Item Insumo", "Categoria", "Medida", "Qtd Atual", "Qtd Min", "Status Alert"]];
      const rows = filteredItems.map(i => [
        i.name,
        (i.category || '').toUpperCase(),
        i.unit,
        i.currentQuantity.toString(),
        i.minQuantity.toString(),
        i.currentQuantity <= i.minQuantity ? 'ESTOQUE CRÍTICO' : 'DISPONÍVEL'
      ]);

      autoTable(doc, {
        startY: 50,
        head: headers,
        body: rows,
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229] },
        styles: { fontSize: 8 }
      });
      doc.save("Relatorio_Inventario_AgroGestao.pdf");
    } else {
      const headers = [["Item", "Ação", "Qtd", "Motivo", "Responsável", "Registrado Em"]];
      const rows = movements.map(m => [
        m.itemName,
        m.type === 'in' ? 'ENTRADA (+)' : 'RETIRADA (-)',
        m.quantity.toString(),
        m.reason,
        m.responsibleName,
        formatDateTime(m.createdAt)
      ]);

      autoTable(doc, {
        startY: 50,
        head: headers,
        body: rows,
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229] },
        styles: { fontSize: 8 }
      });
      doc.save("Relatorio_Movimentacoes_Almoxarifado.pdf");
    }
    toast.success("Documento em PDF gerado!");
  };

  return (
    <div className="flex flex-col gap-6 h-full overflow-y-auto custom-scrollbar pr-1" id="inventory-module">
      {/* Title Header */}
      <div className={PAGE_HEADER_CLASS} data-page-header>
        <PageTitle icon={PageIcon} title="Estoque / Insumos" subtitle="Controle de insumos, ferramentas de campo e reagentes" />
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsScannerModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs transition-all font-semibold text-xs uppercase tracking-wider"
            id="scan-barcode-btn"
            title="Escanear Código de Barras ou QR Code"
          >
            <ScanBarcode className="w-4 h-4" />
            <span>Leitor Barcode</span>
          </button>

          {isAdmin && (
            <button 
              onClick={() => setIsAddItemModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md transition-all font-medium text-sm"
              id="add-item-btn"
            >
              <PlusCircle className="w-4 h-4" />
              Novo Insumo
            </button>
          )}

          <div className="flex bg-slate-100 rounded-xl p-0.5 border border-slate-200">
            <button 
              onClick={handleExportXLSX}
              className="p-2 hover:bg-white text-slate-600 rounded-lg transition-all"
              title="Planilha Excel"
            >
              <FileSpreadsheet className="w-4 h-4" />
            </button>
            <button 
              onClick={handleExportPDF}
              className="p-2 hover:bg-white text-slate-600 rounded-lg transition-all"
              title="Laudo PDF"
            >
              <FileText className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6" id="inventory-stats">
        <div className="glass-card p-6 border-slate-200 flex items-center justify-between shadow-sm relative overflow-hidden bg-white/60">
          <div>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">Itens Catalogados</span>
            <span className="text-2xl font-display font-bold text-slate-800 block mt-1">
              {totalItemsCount} Insumos
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-slate-600 shrink-0">
            <Package className="w-6 h-6" />
          </div>
        </div>

        <div className="glass-card p-6 border-slate-200 flex items-center justify-between shadow-sm relative overflow-hidden bg-white/60">
          <div>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">Estoque Crítico</span>
            <span className={`text-2xl font-display font-bold block mt-1 ${lowStockCount > 0 ? 'text-amber-600 animate-pulse' : 'text-slate-700'}`}>
              {lowStockCount} Alertas Ativos
            </span>
          </div>
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${lowStockCount > 0 ? 'bg-amber-500/10 text-amber-600' : 'bg-slate-100 text-slate-400'}`}>
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>

        <div className="glass-card p-6 border-slate-200 flex items-center justify-between shadow-sm relative overflow-hidden bg-white/60">
          <div>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">Movimentações Ativas</span>
            <span className="text-2xl font-display font-bold text-emerald-600 block mt-1">
              {movements.length} Registros
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-600 shrink-0">
            <ArrowLeftRight className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Layout Tab Switcher */}
      <div className="flex border-b border-slate-200 gap-6">
        <button 
          onClick={() => setActiveTab('items')}
          className={`pb-3 font-semibold text-sm transition-all relative ${
            activeTab === 'items' ? 'text-slate-600 font-bold' : 'text-slate-500 hover:text-slate-800'
          }`}
          id="tab-items-btn"
        >
          {activeTab === 'items' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600 rounded-full" />}
          Insumos de Campo
        </button>
        <button 
          onClick={() => setActiveTab('movements')}
          className={`pb-3 font-semibold text-sm transition-all relative flex items-center gap-1.5 ${
            activeTab === 'movements' ? 'text-slate-600 font-bold' : 'text-slate-500 hover:text-slate-800'
          }`}
          id="tab-movements-btn"
        >
          {activeTab === 'movements' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600 rounded-full" />}
          <History className="w-4 h-4 text-slate-400" />
          Histórico de Fluxo de Almoxarifado
        </button>
      </div>

      {activeTab === 'items' ? (
        <>
          {/* Quick Filters */}
          <div className="glass-card p-4 border-slate-200 bg-white/40 flex flex-col md:flex-row gap-3 items-center justify-between shadow-xs">
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Buscar insumo ou fabricante..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex gap-2 w-full md:w-auto">
              {/* Category */}
              <select 
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none"
              >
                <option value="all">Categoria: Todas</option>
                <option value="ferramentas">Equipamentos/Ferramentas</option>
                <option value="quimicos">Químicos/Reagentes de Solo</option>
                <option value="tubulacao">Tubulações/Irrigação</option>
                <option value="piquetes">Estacas/Piquetes Topografia</option>
                <option value="outros">Outros Insumos</option>
              </select>

              {/* Stock Status Warning */}
              <select 
                value={stockStatusFilter}
                onChange={(e) => setStockStatusFilter(e.target.value)}
                className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none"
              >
                <option value="all">Status: Todos</option>
                <option value="warning">Apenas Críticos (Abaixo do Mín.)</option>
                <option value="ok">Estáveis</option>
              </select>
            </div>
          </div>

          {loading ? (
            <SkeletonList variant="table" count={5} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" id="inventory-grid">
              {filteredItems.map(item => {
                const isCrit = item.currentQuantity <= item.minQuantity;
                return (
                  <div key={item.id} className={`glass-card p-6 border-slate-200 shadow-sm relative flex flex-col justify-between transition-all bg-white/80 ${isCrit ? 'ring-1 ring-amber-400/50 bg-amber-500/[0.02]' : ''}`}>
                    <div>
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">{item.category}</span>
                          <h3 className="font-display font-bold text-base text-slate-800 mt-1">{item.name}</h3>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {isCrit ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 bg-amber-500/10 text-amber-700 rounded-full uppercase tracking-tighter animate-pulse">
                              <AlertTriangle className="w-3 h-3" />
                              Crítico
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 bg-emerald-500/10 text-emerald-700 rounded-full uppercase tracking-tighter">
                              Estável
                            </span>
                          )}
                          {item.expiryDate && new Date(item.expiryDate) < new Date() && (
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 uppercase tracking-tight">
                              Validade Vencida
                            </span>
                          )}
                          {item.expiryDate && new Date(item.expiryDate) >= new Date() &&
                           new Date(item.expiryDate) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) && (
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 uppercase tracking-tight">
                              Vence em breve
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mt-6 border-t border-slate-50 pt-4">
                        <div>
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Saldo Atual</span>
                          <p className="text-xl font-display font-bold text-slate-800 mt-0.5">
                            {item.currentQuantity} <span className="text-xs font-normal text-slate-500">{item.unit}</span>
                          </p>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Qtd Mínima</span>
                          <p className="text-sm font-semibold text-slate-600 mt-2">
                            {item.minQuantity} {item.unit}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 bg-slate-50 rounded-xl p-3 border border-slate-100 flex justify-between items-center">
                        <div>
                          <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Fornecedor principal</span>
                          <span className="text-xs font-medium text-slate-700 block truncate max-w-[140px]">{item.supplier || 'Geral'}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Est. Unitário</span>
                          <span className="text-xs font-bold text-slate-700 block">{formatCurrency((item.unitCost || 0))}</span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 mt-6 border-t border-slate-100 flex items-center justify-between gap-1.5">
                      {isAuthorized ? (
                        <div className="flex gap-1.5">
                          <button 
                            onClick={() => openQuickMovement(item, 'in')}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold transition-all"
                            title="Lançar Entrada de Insumo"
                          >
                            <ArrowUp className="w-3 h-3" />
                            Entrada
                          </button>
                          <button 
                            onClick={() => openQuickMovement(item, 'out')}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold transition-all"
                            title="Fazer Retirada Autorizada"
                          >
                            <ArrowDown className="w-3 h-3" />
                            Retirar
                          </button>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-450 italic">Visualização Limitada</div>
                      )}

                      {isAdmin && (
                        <button 
                          onClick={() => setIsDeleteModalOpen(item.id)}
                          className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-all ml-auto"
                          title="Remover Registro de Catálogo"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {filteredItems.length === 0 && (
                <div className="col-span-1 md:col-span-2 lg:col-span-3 text-center py-16 text-slate-400 uppercase tracking-widest text-xs">
                  Nenhum insumo localizado com os critérios solicitados.
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        /* History of movements */
        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs bg-white/80" id="movements-table">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-xs font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200">
                <th className="px-6 py-4">Insumo / Material</th>
                <th className="px-6 py-4 text-center">Tipo</th>
                <th className="px-6 py-4 text-center">Quantidade</th>
                <th className="px-6 py-4">Contexto / Justificativa</th>
                <th className="px-6 py-4">Colaborador Atribuído</th>
                <th className="px-6 py-4 text-right">Data / Hora</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {movements.map(m => (
                <tr key={m.id} className="hover:bg-slate-50/80 transition-all">
                  <td className="px-6 py-4 font-semibold text-slate-700">
                    {m.itemName}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold tracking-tight uppercase ${
                      m.type === 'in' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-rose-500/10 text-rose-700'
                    }`}>
                      {m.type === 'in' ? 'Entrada' : 'Retirada'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center font-mono font-bold text-slate-750">
                    {m.quantity}
                  </td>
                  <td className="px-6 py-4 text-slate-600 max-w-xs truncate" title={m.reason}>
                    {m.reason}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-slate-600">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <span>{m.responsibleName}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-xs text-slate-500">
                    {formatDateTime(m.createdAt)}
                  </td>
                </tr>
              ))}
              
              {movements.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-400 uppercase tracking-widest text-xs">
                    Nenhuma movimentação de almoxarifado no banco.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Catalog Item Modal */}
      {isAddItemModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h2 className="font-display font-bold text-lg text-slate-800">Novo Insumo no Almoxarifado</h2>
              <button 
                onClick={() => setIsAddItemModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                &times;
              </button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); runExclusive('Inventory.handleCreateItem', () => handleCreateItem(e)); }} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Nome do Item</label>
                  <input 
                    type="text"
                    required
                    placeholder="Estacas de demarcação de alumínio 2 metros..."
                    value={itemForm.name}
                    onChange={(e) => setItemForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Categoria de Uso</label>
                  <select 
                    value={itemForm.category}
                    onChange={(e) => setItemForm(prev => ({ ...prev, category: e.target.value }))}
                    className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white"
                  >
                    <option value="ferramentas">C. Equipamentos/Ferramentas</option>
                    <option value="quimicos">Químicos/Reagentes solo</option>
                    <option value="tubulacao">Tubulações/Irrigação</option>
                    <option value="piquetes">Estacas/Piquetes Topografia</option>
                    <option value="outros">Outros</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Unidade de Medida</label>
                  <input 
                    type="text"
                    required
                    placeholder="metros / sacos / unidades"
                    value={itemForm.unit}
                    onChange={(e) => setItemForm(prev => ({ ...prev, unit: e.target.value }))}
                    className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Saldo Inicial</label>
                  <input 
                    type="number" step="any"
                    required
                    placeholder="50"
                    value={itemForm.currentQuantity}
                    onChange={(e) => setItemForm(prev => ({ ...prev, currentQuantity: e.target.value }))}
                    className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Estoque Crítico (Mínmo)</label>
                  <input 
                    type="number" step="any"
                    required
                    placeholder="10"
                    value={itemForm.minQuantity}
                    onChange={(e) => setItemForm(prev => ({ ...prev, minQuantity: e.target.value }))}
                    className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Custo Unitário (R$)</label>
                  {canPrice ? (
                    <input 
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={itemForm.unitCost}
                      onChange={(e) => setItemForm(prev => ({ ...prev, unitCost: e.target.value }))}
                      className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 glass-input"
                    />
                  ) : (
                    <p className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 glass-input bg-slate-50 text-slate-500 cursor-not-allowed">
                      {itemForm.unitCost ? `${formatCurrency(Number(itemForm.unitCost))}` : 'R$ 0,00'} <span className="text-xs text-amber-600 font-semibold">(somente admin)</span>
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-505 uppercase block mb-1">Fornecedor Preferencial</label>
                  <input 
                    type="text"
                    placeholder="AgroShop Distribuidora"
                    value={itemForm.supplier}
                    onChange={(e) => setItemForm(prev => ({ ...prev, supplier: e.target.value }))}
                    className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-505 uppercase block mb-1">Código de Barras / EAN / QR</label>
                  <input 
                    type="text"
                    placeholder="7891234567890"
                    value={itemForm.barcode || ''}
                    onChange={(e) => setItemForm(prev => ({ ...prev, barcode: e.target.value }))}
                    className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 font-mono"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-505 uppercase block mb-1">Número do Lote</label>
                  <input 
                    type="text"
                    placeholder="LT-2025/08"
                    value={itemForm.lotNumber || ''}
                    onChange={(e) => setItemForm(prev => ({ ...prev, lotNumber: e.target.value }))}
                    className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 font-mono"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-505 uppercase block mb-1">Data de Validade (Opcional)</label>
                  <input 
                    type="date"
                    value={itemForm.expiryDate || ''}
                    onChange={(e) => setItemForm(prev => ({ ...prev, expiryDate: e.target.value }))}
                    className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
                <button 
                  type="button" 
                  onClick={() => setIsAddItemModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm hover:bg-emerald-700 transition-all font-semibold"
                >
                  Salvar no Catálogo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Movement Modal (Quick check-out or entry) */}
      {isMovementModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-sm w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h2 className="font-display font-bold text-sm text-slate-800 uppercase tracking-wider">
                Movimentação: {selectedItemForMovement?.name}
              </h2>
              <button 
                onClick={() => setIsMovementModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                &times;
              </button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); runExclusive('Inventory.handleRegisterMovement', () => handleRegisterMovement(e)); }} className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-400 block uppercase tracking-wide mb-1.5">Direção do Estoque</label>
                <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-lg border border-slate-200">
                  <button 
                    type="button" 
                    onClick={() => setMovementForm(prev => ({ ...prev, type: 'out' }))}
                    className={`py-1 font-bold text-xs rounded-md transition-all ${
                      movementForm.type === 'out' 
                        ? 'bg-white text-slate-700 shadow-xs' 
                        : 'text-slate-500'
                    }`}
                  >
                    Retirada (Saída)
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setMovementForm(prev => ({ ...prev, type: 'in' }))}
                    className={`py-1 font-bold text-xs rounded-md transition-all ${
                      movementForm.type === 'in' 
                        ? 'bg-white text-emerald-700 shadow-xs' 
                        : 'text-slate-500'
                    }`}
                  >
                    Reposição (Entrada)
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Quantidade ({selectedItemForMovement?.unit})</label>
                <input 
                  type="number" step="any"
                  required
                  placeholder="Ex: 5"
                  value={movementForm.quantity}
                  onChange={(e) => setMovementForm(prev => ({ ...prev, quantity: e.target.value }))}
                  className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Lote Rastreável</label>
                  <input 
                    type="text"
                    placeholder="LT-012"
                    value={movementForm.lotNumber || ''}
                    onChange={(e) => setMovementForm(prev => ({ ...prev, lotNumber: e.target.value }))}
                    className="w-full text-xs border border-slate-200 rounded-xl px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Receituário / ART</label>
                  <input 
                    type="text"
                    placeholder="REC-8921"
                    value={movementForm.recipeNumber || ''}
                    onChange={(e) => setMovementForm(prev => ({ ...prev, recipeNumber: e.target.value }))}
                    className="w-full text-xs border border-slate-200 rounded-xl px-2.5 py-1.5 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Justificativa / Motivação</label>
                <textarea 
                  required
                  rows={2}
                  value={movementForm.reason}
                  onChange={(e) => setMovementForm(prev => ({ ...prev, reason: e.target.value }))}
                  className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none"
                  placeholder="Demarcação da divisa do imóvel Córrego Grande..."
                />
              </div>

              <div className="pt-4 border-t border-slate-105 flex justify-end gap-2">
                <button 
                  type="button" 
                  onClick={() => setIsMovementModalOpen(false)}
                  className="px-3.5 py-1.5 border border-slate-200 text-slate-600 rounded-xl text-xs"
                >
                  Voltar
                </button>
                <button 
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 text-white rounded-xl text-xs hover:bg-emerald-700 transition-all font-bold"
                >
                  Registrar Alteração
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Barcode & QR Code Scanner Modal */}
      {isScannerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="bg-slate-50 dark:bg-slate-800/80 px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <ScanBarcode className="w-5 h-5 text-emerald-600" />
                <h3 className="font-display font-bold text-sm text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                  Leitor de Código de Barras / QR
                </h3>
              </div>
              <button 
                onClick={() => { setIsScannerModalOpen(false); setScannedCodeInput(''); }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Camera Scanner View Simulation */}
              <div className="relative aspect-video rounded-xl bg-slate-950 border-2 border-dashed border-emerald-500/50 flex flex-col items-center justify-center overflow-hidden p-4">
                <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-0.5 bg-emerald-500 shadow-[0_0_12px_#10b981] animate-pulse"></div>
                <div className="z-10 flex flex-col items-center gap-2 text-center">
                  <QrCode className="w-12 h-12 text-emerald-400 opacity-80" />
                  <p className="text-[11px] text-emerald-300 font-mono">
                    Posicione o código de barras ou QR Code do insumo na mira
                  </p>
                </div>
              </div>

              {/* Direct Code Input / Scanner hardware trigger */}
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                  Digite ou Escaneie o Código:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    autoFocus
                    value={scannedCodeInput}
                    onChange={(e) => setScannedCodeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleQuickBarcodeLookup(scannedCodeInput);
                      }
                    }}
                    placeholder="EAN / Código do Lote / Nome..."
                    className="flex-1 text-sm border border-slate-200 dark:border-slate-700 dark:bg-slate-800 rounded-xl px-3 py-2 font-mono font-bold text-slate-800 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => handleQuickBarcodeLookup(scannedCodeInput)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
                  >
                    Localizar
                  </button>
                </div>
              </div>

              {/* Quick suggestions from existing stock */}
              {items.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                    Insumos Frequentes para Teste Rápido:
                  </span>
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                    {items.slice(0, 6).map(i => (
                      <button
                        key={i.id}
                        type="button"
                        onClick={() => {
                          setScannedCodeInput(i.barcode || i.name);
                          handleQuickBarcodeLookup(i.barcode || i.name);
                        }}
                        className="text-[11px] px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950 text-slate-700 dark:text-slate-300 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors text-left truncate max-w-full"
                      >
                        {i.name} {i.barcode ? `(${i.barcode})` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmationModal 
        isOpen={isDeleteModalOpen !== null}
        title="Expurgar Registro de Catálogo"
        description="Esta exclusão eliminará definitivamente todo o saldo fiduciário, logs de compra e alertas inerentes a este insumo de campo."
        confirmLabel="Deletar Item"
        onConfirm={handleDeleteItem}
        onClose={() => setIsDeleteModalOpen(null)}
      />
    </div>
  );
}
