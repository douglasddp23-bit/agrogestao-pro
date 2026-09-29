import React, { useState, useEffect } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Car, 
  Plus, 
  Search, 
  FileText, 
  TrendingUp, 
  Wrench, 
  Navigation,
  Trash2,
  X,
  Link2
} from 'lucide-react';
import { collection, onSnapshot, addDoc, doc, deleteDoc, updateDoc, query, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import SkeletonList from '../components/SkeletonList';
import ConfirmationModal from '../components/ConfirmationModal';
import { formatDate, todayLocalDateString } from '../lib/utils';
import { exportToExcel } from '../lib/exportExcel';
import { Vehicle, VehicleTrip, FieldVisit } from '../types';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { Car as PageIcon } from 'lucide-react';
import { useInitialSearch } from '../hooks/useInitialSearch';

export default function Vehicles() {
  const { user } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [trips, setTrips] = useState<VehicleTrip[]>([]);
  const [visits, setVisits] = useState<FieldVisit[]>([]);
  const [loading, setLoading] = useState(true);

  // Active tab: 'fleet' or 'trips'
  const [activeTab, setActiveTab] = useState<'fleet' | 'trips'>('fleet');

  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');
  useInitialSearch(setSearchTerm); // termo vindo da Busca Global

  // Modals
  const [isAddVehicleOpen, setIsAddVehicleOpen] = useState(false);
  const [isLogTripOpen, setIsLogTripOpen] = useState(false);
  const [isDeleteVehicleId, setIsDeleteVehicleId] = useState<string | null>(null);

  // Forms Vehicle
  const [formPlate, setFormPlate] = useState('');
  const [formBrand, setFormBrand] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formYear, setFormYear] = useState(new Date().getFullYear());
  const [formFuelType, setFormFuelType] = useState<'flex' | 'diesel' | 'gasolina' | 'eletrico'>('flex');
  const [formCurrentKm, setFormCurrentKm] = useState('');
  const [formInsuranceExpiry, setFormInsuranceExpiry] = useState('');
  const [formIpvaExpiry, setFormIpvaExpiry] = useState('');
  const [formCrlvExpiry, setFormCrlvExpiry] = useState('');
  const [formNextMaintenanceDate, setFormNextMaintenanceDate] = useState('');

  // Forms Trip
  const [formTripPlate, setFormTripPlate] = useState('');
  const [formDriverName, setFormDriverName] = useState(user?.displayName || user?.email || '');
  const [formTripDate, setFormTripDate] = useState(todayLocalDateString());
  const [formStartKm, setFormStartKm] = useState('');
  const [formEndKm, setFormEndKm] = useState('');
  const [formDestination, setFormDestination] = useState('');
  const [formPurpose, setFormPurpose] = useState('');
  const [formFuelFilled, setFormFuelFilled] = useState('');
  const [formFuelCost, setFormFuelCost] = useState('');
  const [formLinkedVisitId, setFormLinkedVisitId] = useState('');

  const [saving, setSaving] = useState(false);

  // Real-time listener
  useEffect(() => {
    const unsubVehicles = onSnapshot(collection(db, 'vehicles'), (snap) => {
      setVehicles(snap.docs.map(d => ({ id: d.id, ...d.data() } as Vehicle)));
    });

    const qTrips = query(collection(db, 'vehicle_trips'), orderBy('createdAt', 'desc'));
    const unsubTrips = onSnapshot(qTrips, (snap) => {
      setTrips(snap.docs.map(d => ({ id: d.id, ...d.data() } as VehicleTrip)));
      setLoading(false);
    }, (e) => {
      console.warn("vehicle_trips subscription failed, falling back cleanly.");
      setLoading(false);
    });

    const unsubVisits = onSnapshot(collection(db, 'field_visits'), (snap) => {
      setVisits(snap.docs.map(d => ({ id: d.id, ...d.data() } as FieldVisit)));
    });

    return () => {
      unsubVehicles();
      unsubTrips();
      unsubVisits();
    };
  }, []);

  const getVehicleAlerts = (v: Vehicle) => {
    const alerts: { label: string; type: 'expired' | 'warning' }[] = [];
    const now = new Date();
    const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    if (v.insuranceExpiry) {
      const d = new Date(v.insuranceExpiry);
      if (d < now) alerts.push({ label: 'Seguro Vencido', type: 'expired' });
      else if (d <= thirtyDays) alerts.push({ label: 'Seguro a Vencer', type: 'warning' });
    }

    if (v.ipvaExpiry) {
      const d = new Date(v.ipvaExpiry);
      if (d < now) alerts.push({ label: 'IPVA Vencido', type: 'expired' });
      else if (d <= thirtyDays) alerts.push({ label: 'IPVA a Vencer', type: 'warning' });
    }

    if (v.crlvExpiry) {
      const d = new Date(v.crlvExpiry);
      if (d < now) alerts.push({ label: 'CRLV Vencido', type: 'expired' });
      else if (d <= thirtyDays) alerts.push({ label: 'CRLV a Vencer', type: 'warning' });
    }

    if (v.nextMaintenanceDate) {
      const d = new Date(v.nextMaintenanceDate);
      if (d < now) alerts.push({ label: 'Revisão Vencida', type: 'expired' });
      else if (d <= thirtyDays) alerts.push({ label: 'Revisão Próxima', type: 'warning' });
    }

    if (v.lastMaintenanceKm && v.maintenanceIntervalKm) {
      const targetKm = v.lastMaintenanceKm + v.maintenanceIntervalKm;
      const diff = targetKm - v.currentKm;
      if (diff <= 0) {
        alerts.push({ label: 'Revisão por KM Vencida', type: 'expired' });
      } else if (diff <= 500) {
        alerts.push({ label: `Revisão em ${diff} km`, type: 'warning' });
      }
    }

    return alerts;
  };

  const handleCreateVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formPlate || !formBrand || !formModel || !formCurrentKm) {
      toast.error("Por favor, preencha todos os campos do veículo.");
      return;
    }

    setSaving(true);
    try {
      const payload: Omit<Vehicle, 'id'> = {
        plate: formPlate.toUpperCase(),
        brand: formBrand,
        model: formModel,
        year: formYear,
        fuelType: formFuelType,
        currentKm: Number(formCurrentKm),
        insuranceExpiry: formInsuranceExpiry || undefined,
        ipvaExpiry: formIpvaExpiry || undefined,
        crlvExpiry: formCrlvExpiry || undefined,
        nextMaintenanceDate: formNextMaintenanceDate || undefined,
        status: 'available',
        createdAt: new Date().toISOString()
      };

      await addDoc(collection(db, 'vehicles'), payload);
      toast.success("Veículo corporativo adicionado à frota de consultoria!");
      setIsAddVehicleOpen(false);
      resetVehicleForm();
    } catch (err: any) {
      toast.error("Erro ao adicionar veículo: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const resetVehicleForm = () => {
    setFormPlate('');
    setFormBrand('');
    setFormModel('');
    setFormYear(new Date().getFullYear());
    setFormFuelType('flex');
    setFormCurrentKm('');
    setFormInsuranceExpiry('');
    setFormIpvaExpiry('');
    setFormCrlvExpiry('');
    setFormNextMaintenanceDate('');
  };

  const handleLogTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTripPlate || !formStartKm || !formEndKm || !formDestination) {
      toast.error("Por favor, preencha os campos obrigatórios do diário de viagem.");
      return;
    }

    const kmStart = Number(formStartKm);
    const kmEnd = Number(formEndKm);

    if (kmEnd < kmStart) {
      toast.error("O odômetro de retorno não pode ser menor do que o odômetro de saída.");
      return;
    }

    // Capture matching client information if visit linked
    let matchedClientId = '';
    let matchedClientName = '';
    if (formLinkedVisitId) {
      const v = visits.find(visit => visit.id === formLinkedVisitId);
      if (v) {
        matchedClientId = v.clientId;
        matchedClientName = v.clientName;
      }
    }

    setSaving(true);
    try {
      const selectedVeh = vehicles.find(v => v.plate === formTripPlate);

      const tripPayload: Omit<VehicleTrip, 'id'> = {
        vehicleId: selectedVeh?.id || '',
        vehiclePlate: formTripPlate,
        driverId: user?.uid || '',
        driverName: formDriverName,
        clientId: matchedClientId || undefined,
        clientName: matchedClientName || undefined,
        purpose: formPurpose,
        destination: formDestination,
        startKm: kmStart,
        endKm: kmEnd,
        startedAt: formTripDate,
        endedAt: formTripDate,
        linkedVisitId: formLinkedVisitId || undefined,
        notes: (formFuelCost || formFuelFilled) ? `Combustível: ${formFuelFilled || 0}L (R$ ${formFuelCost || 0})` : undefined,
        createdAt: new Date().toISOString()
      };

      await addDoc(collection(db, 'vehicle_trips'), tripPayload);

      // Smoothly update referenced vehicle current odometer on the fly
      if (selectedVeh) {
        await updateDoc(doc(db, 'vehicles', selectedVeh.id), {
          currentKm: kmEnd,
          status: 'available'
        });
      }

      toast.success("Diário de quilometragem gravado com sucesso!");
      setIsLogTripOpen(false);
      resetTripForm();
    } catch (err: any) {
      toast.error("Erro ao fechar viagem: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const resetTripForm = () => {
    setFormTripPlate('');
    setFormDriverName(user?.displayName || user?.email || '');
    setFormTripDate(todayLocalDateString());
    setFormStartKm('');
    setFormEndKm('');
    setFormDestination('');
    setFormPurpose('');
    setFormFuelFilled('');
    setFormFuelCost('');
    setFormLinkedVisitId('');
  };

  const handleDeleteVehicle = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'vehicles', id));
      toast.success("Veículo retirado da frota.");
      setIsDeleteVehicleId(null);
    } catch (err) {
      toast.error("Erro ao excluir veículo.");
    }
  };

  const toggleVehicleStatus = async (vehicle: Vehicle) => {
    const nextStatus = vehicle.status === 'available' ? 'in_use' : vehicle.status === 'in_use' ? 'maintenance' : 'available';
    try {
      await updateDoc(doc(db, 'vehicles', vehicle.id), { status: nextStatus });
      toast.success(`Status de ${vehicle.plate} alterado para ${({ available: 'Disponível', in_use: 'Em uso', maintenance: 'Em manutenção' } as Record<string, string>)[nextStatus] || nextStatus}.`);
    } catch (e) {
      toast.error("Erro ao atualizar status de frota.");
    }
  };

  const handleExportTripsToExcel = () => {
    if (trips.length === 0) {
      toast.error("Nenhum deslocamento gravado para exportação.");
      return;
    }
    const data = trips.map(t => ({
      Data: formatDate(t.startedAt),
      Placa: t.vehiclePlate,
      Condutor: t.driverName,
      Km_Inicial: t.startKm,
      Km_Final: t.endKm || t.startKm,
      Km_Rodados: (t.endKm || t.startKm) - t.startKm,
      Destino: t.clientName ? `${t.clientName} (Propriedade)` : 'Deslocamento',
      Objetivo: t.purpose,
      Notas: t.notes || ''
    }));
    exportToExcel(data, "Diario_de_Quilometragem_AgroGestao", "Km Rodados");
    toast.success("Histórico de deslocamentos em Excel exportado com sucesso!");
  };

  // Stats Calculations
  const totalFleetCount = vehicles.length;
  const inMaintenanceCount = vehicles.filter(v => v.status === 'maintenance').length;
  const totalMileage = trips.reduce((sum, t) => sum + ((t.endKm || t.startKm) - t.startKm), 0);
  const activeDisplacements = trips.length;

  const filteredVehicles = vehicles.filter(v => 
    (v.plate || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
    (v.brand || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (v.model || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      
      {/* Upper header */}
      <div className={PAGE_HEADER_CLASS} data-page-header>
        <PageTitle icon={PageIcon} title="Veículos / Km" subtitle="Frota, diário de bordo, viagens e vencimentos" />

        <div className="flex gap-2">
          <button
            onClick={() => setIsAddVehicleOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white hover:bg-slate-800 text-xs font-bold rounded-xl transition-all"
          >
            <Plus className="w-5 h-5" /> Cadastrar Veículo
          </button>
          <button
            onClick={() => setIsLogTripOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-bold rounded-xl transition-all shadow-md shadow-emerald-100"
          >
            <Navigation className="w-4 h-4" /> Registrar Viagem
          </button>
        </div>
      </div>

      {/* Stats Counter */}
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-6">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Veículos Totais</span>
            <span className="text-2xl font-display font-bold text-slate-850 mt-1 block">{totalFleetCount} carros</span>
          </div>
          <div className="w-10 h-10 bg-slate-50 border rounded-xl flex items-center justify-center text-slate-500">
            <Car className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Em Manutenção</span>
            <span className="text-2xl font-display font-bold text-amber-600 mt-1 block">{inMaintenanceCount} veículos</span>
          </div>
          <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-amber-500">
            <Wrench className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Quilometragem Acumulada</span>
            <span className="text-2xl font-display font-bold text-slate-700 mt-1 block">{totalMileage} Km Rodados</span>
          </div>
          <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-500">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-emerald-50 border-emerald-100 p-5 rounded-2xl border shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">Viagens Gravadas</span>
            <span className="text-2xl font-display font-bold text-emerald-700 mt-1 block">{activeDisplacements} registros</span>
          </div>
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600">
            <Navigation className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Tabs list switch selection */}
      <div className="border-b border-slate-200 flex items-center justify-between">
        <div className="flex gap-4">
          <button
            onClick={() => setActiveTab('fleet')}
            className={`pb-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
              activeTab === 'fleet' ? 'border-emerald-600 text-slate-600' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            Controle de Frota
          </button>
          <button
            onClick={() => setActiveTab('trips')}
            className={`pb-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
              activeTab === 'trips' ? 'border-emerald-600 text-slate-600' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            Diário de Km de Viagem
          </button>
        </div>

        {activeTab === 'trips' && (
          <button
            onClick={handleExportTripsToExcel}
            className="mb-2 flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 text-slate-600 rounded-xl text-xs hover:bg-slate-50 transition-colors"
          >
            <FileText className="w-4 h-4" /> Planilha de Reembolso km
          </button>
        )}
      </div>

      {/* Filters input */}
      <div className="bg-white p-4 rounded-xl border flex items-center">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input 
            type="text"
            placeholder="Buscar veículo por placa, marca ou modelo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border rounded-lg text-xs"
          />
        </div>
      </div>

      {loading ? (
        <SkeletonList variant="table" count={4} />
      ) : activeTab === 'fleet' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fadeIn">
          {filteredVehicles.length === 0 ? (
            <div className="col-span-3 bg-white p-12 text-center rounded-2xl border border-dashed">
              <Car className="w-12 h-12 text-slate-300 mx-auto mb-2" />
              <p className="text-xs text-slate-500">Nenhum veículo corporativo cadastrado.</p>
            </div>
          ) : (
            filteredVehicles.map(v => (
              <div key={v.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 hover:border-slate-300 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-50 text-slate-700 rounded-xl flex items-center justify-center">
                      <Car className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">{v.brand} {v.model}</h4>
                      <span className="font-mono text-xs text-slate-400">{v.plate}</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <span className={`px-2 py-0.5 text-[9px] font-bold uppercase border rounded-lg ${
                      v.status === 'available' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' :
                      v.status === 'in_use' ? 'bg-slate-100 text-slate-805 border-slate-205' :
                      'bg-amber-100 text-amber-805 border-amber-200'
                    }`}>
                      {v.status === 'available' ? 'Disponível' : v.status === 'in_use' ? 'Em Uso' : 'Manutenção'}
                    </span>
                    {getVehicleAlerts(v).map((alert, idx) => (
                      <span
                        key={idx}
                        className={`px-2 py-0.5 text-[8px] font-bold uppercase rounded border ${
                          alert.type === 'expired' 
                            ? 'bg-rose-100 text-rose-700 border-rose-200' 
                            : 'bg-amber-100 text-amber-700 border-amber-200'
                        }`}
                      >
                        {alert.label}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="p-3 bg-slate-50 border rounded-xl flex items-center justify-between text-xs">
                  <div>
                    <span className="text-[10px] text-slate-400 font-medium block">Quilometragem</span>
                    <span className="font-bold text-slate-700 font-mono">{(v.currentKm || 0).toLocaleString()} Km</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-medium block">Combustível</span>
                    <span className="font-bold text-slate-700 uppercase">{v.fuelType || 'Flex'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-medium block">Ano</span>
                    <span className="font-bold text-slate-700">{v.year}</span>
                  </div>
                </div>

                {/* Operations tools */}
                <div className="pt-2 border-t flex items-center justify-between gap-2 text-[10px] uppercase font-bold text-slate-500">
                  <button 
                    onClick={() => toggleVehicleStatus(v)}
                    className="p-1.5 hover:bg-slate-50 rounded-lg flex items-center gap-1"
                  >
                    <Wrench className="w-3.5 h-3.5 text-amber-600" /> Alterar Status
                  </button>
                  {(user?.effectiveRole ?? user?.role) === 'admin' && (
                  <button 
                    onClick={() => setIsDeleteVehicleId(v.id)}
                    className="p-1.5 hover:bg-rose-50 rounded-lg text-rose-600 flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Retirar Frota
                  </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        /* Trips Table view logic */
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm animate-fadeIn">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-xs font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200 animate-fadeIn">
                  <th className="px-6 py-4">Data</th>
                  <th className="px-6 py-4">Veículo Placa</th>
                  <th className="px-6 py-4">Condutor / Técnico</th>
                  <th className="px-6 py-4">Registros Km</th>
                  <th className="px-6 py-4">Km Rodados</th>
                  <th className="px-6 py-4">Destino / Cliente</th>
                  <th className="px-6 py-4">Integração</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {trips.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-400 text-xs">Nenhum deslocamento físico rodado.</td>
                  </tr>
                ) : (
                  trips.map(item => (
                    <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 font-mono text-xs text-slate-500 whitespace-nowrap">
                        {formatDate(item.startedAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2.5 py-1 bg-slate-100 border rounded font-mono text-xs font-bold uppercase text-slate-800">{item.vehiclePlate}</span>
                      </td>
                      <td className="px-6 py-4 font-bold text-slate-700 whitespace-nowrap">
                        {item.driverName}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-slate-500 whitespace-nowrap">
                        {item.startKm} a {item.endKm || item.startKm}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap font-bold text-slate-700">
                        +{(item.endKm || item.startKm) - item.startKm} Km
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-medium text-slate-800 block">{item.clientName || 'Geral'}</span>
                        <span className="text-[10px] text-slate-400 mt-0.5">{item.purpose}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {item.linkedVisitId ? (
                          <span className="px-2 py-0.5 text-[9px] font-bold border rounded-lg bg-slate-50 text-slate-700 border-slate-100 flex items-center gap-1 w-fit">
                            <Link2 className="w-3 h-3" /> Visita de Campo
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">-</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add vehicle modal */}
      <AnimatePresence>
        {isAddVehicleOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl w-full max-w-sm p-6 space-y-4 relative text-slate-800 animate-fadeIn"
            >
              <div className="flex items-center justify-between border-b pb-3">
                <h3 className="font-display font-bold text-slate-850">Cadastrar Novo Veículo</h3>
                <button onClick={() => setIsAddVehicleOpen(false)} className="p-1 px-2.5 bg-slate-50 rounded-full text-slate-400">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); runExclusive('Vehicles.handleCreateVehicle', () => handleCreateVehicle(e)); }} className="space-y-4 text-xs">
                
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-450 uppercase">Placa Corporativa</label>
                  <input 
                    type="text"
                    value={formPlate}
                    onChange={(e) => setFormPlate(e.target.value)}
                    placeholder="Ex: ABC-1234 ou BRA2V22"
                    className="w-full glass-input"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-450 uppercase">Marca</label>
                    <input 
                      type="text"
                      value={formBrand}
                      onChange={(e) => setFormBrand(e.target.value)}
                      placeholder="Ex: Toyota, Fiat"
                      className="w-full glass-input"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-450 uppercase">Modelo</label>
                    <input 
                      type="text"
                      value={formModel}
                      onChange={(e) => setFormModel(e.target.value)}
                      placeholder="Ex: Hilux, Toro"
                      className="w-full glass-input"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-455 uppercase">Ano Fab.</label>
                    <input 
                      type="number"
                      value={formYear}
                      onChange={(e) => setFormYear(Number(e.target.value))}
                      className="w-full glass-input"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-455 uppercase">Combustível</label>
                    <select
                      value={formFuelType}
                      onChange={(e: any) => setFormFuelType(e.target.value)}
                      className="w-full glass-input"
                    >
                      <option value="flex">Flex (Álcool/Gas.)</option>
                      <option value="diesel">Diesel S10</option>
                      <option value="gasolina">Gasolina Aditivada</option>
                      <option value="eletrico">Elétrico</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-450 uppercase">Quilometragem Inicial (Km)</label>
                  <input 
                    type="number"
                    value={formCurrentKm}
                    onChange={(e) => setFormCurrentKm(e.target.value)}
                    placeholder="Ex: 45000"
                    className="w-full glass-input"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-450 uppercase">Vencimento Seguro</label>
                    <input 
                      type="date"
                      value={formInsuranceExpiry}
                      onChange={(e) => setFormInsuranceExpiry(e.target.value)}
                      className="w-full glass-input"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-450 uppercase">Vencimento IPVA</label>
                    <input 
                      type="date"
                      value={formIpvaExpiry}
                      onChange={(e) => setFormIpvaExpiry(e.target.value)}
                      className="w-full glass-input"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-450 uppercase">Vencimento CRLV</label>
                    <input 
                      type="date"
                      value={formCrlvExpiry}
                      onChange={(e) => setFormCrlvExpiry(e.target.value)}
                      className="w-full glass-input"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-450 uppercase">Próxima Revisão</label>
                    <input 
                      type="date"
                      value={formNextMaintenanceDate}
                      onChange={(e) => setFormNextMaintenanceDate(e.target.value)}
                      className="w-full glass-input"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t">
                  <button type="button" onClick={() => setIsAddVehicleOpen(false)} className="px-4 py-2 border rounded-xl text-slate-500">
                    Cancelar
                  </button>
                  <button type="submit" disabled={saving} className="px-5 py-2 bg-emerald-600 text-white font-bold uppercase rounded-xl">
                    {saving ? 'Adicionando...' : 'Gravar Veículo'}
                  </button>
                </div>

              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Log displacement / km trip modal */}
      <AnimatePresence>
        {isLogTripOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl w-full max-w-md p-6 space-y-4 relative text-slate-800 animate-fadeIn"
            >
              <div className="flex items-center justify-between border-b pb-3">
                <h3 className="font-display font-bold text-slate-850">Registrar Diário de Deslocamento</h3>
                <button onClick={() => setIsLogTripOpen(false)} className="p-1 px-2.5 bg-slate-50 rounded-full text-slate-450">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); runExclusive('Vehicles.handleLogTrip', () => handleLogTrip(e)); }} className="space-y-4 text-xs">
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-450 uppercase">Selecione o Veículo</label>
                    <select
                      value={formTripPlate}
                      onChange={(e) => {
                        setFormTripPlate(e.target.value);
                        // Auto populate starting Km matching currentKm in state
                        const selected = vehicles.find(v => v.plate === e.target.value);
                        if (selected) {
                          setFormStartKm((selected.currentKm || 0).toString());
                        }
                      }}
                      className="w-full glass-input"
                      required
                    >
                      <option value="">Selecione Placa</option>
                      {vehicles.filter(v => v.status === 'available' || v.status === 'in_use').map(v => (
                        <option key={v.id} value={v.plate}>{v.brand} {v.model} ({v.plate})</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-450 uppercase">Data da Viagem</label>
                    <input 
                      type="date"
                      value={formTripDate}
                      onChange={(e) => setFormTripDate(e.target.value)}
                      className="w-full glass-input"
                      required
                    />
                  </div>
                </div>

                {/* Integration 3: Link to field visit dropdown */}
                {formTripDate && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-455 uppercase block">Vincular a Visita de Campo do Dia</label>
                    <select 
                      value={formLinkedVisitId}
                      onChange={(e) => {
                        setFormLinkedVisitId(e.target.value);
                        const linked = visits.find(v => v.id === e.target.value);
                        if (linked) {
                          setFormDestination(linked.clientName || '');
                          setFormPurpose(`Visita Técnica: ${linked.objective || ''}`);
                        }
                      }}
                      className="w-full glass-input"
                    >
                      <option value="">Sem vínculo com visita</option>
                      {visits
                        .filter(v => v.visitDate === formTripDate && (v.technicianId === user?.uid || (user?.effectiveRole ?? user?.role) === 'admin' || (user?.effectiveRole ?? user?.role) === 'manager'))
                        .map(v => (
                          <option key={v.id} value={v.id}>
                            {v.clientName} — Propiedade {v.propertyName || 'N/A'} ({v.objective})
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-450 uppercase">Condutor Técnico</label>
                  <input 
                    type="text"
                    value={formDriverName}
                    onChange={(e) => setFormDriverName(e.target.value)}
                    placeholder="Nome completo do engenheiro condutor"
                    className="w-full glass-input"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-450 uppercase">Km Saída</label>
                    <input 
                      type="number"
                      value={formStartKm}
                      onChange={(e) => setFormStartKm(e.target.value)}
                      placeholder="Ex: 45110"
                      className="w-full glass-input"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-455 uppercase">Km Retorno</label>
                    <input 
                      type="number"
                      value={formEndKm}
                      onChange={(e) => setFormEndKm(e.target.value)}
                      placeholder="Ex: 45290"
                      className="w-full glass-input"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-450 uppercase">Destino Propriedade / Município</label>
                    <input 
                      type="text"
                      value={formDestination}
                      onChange={(e) => setFormDestination(e.target.value)}
                      placeholder="Ex: Primavera do Leste MT, Fazenda Sol..."
                      className="w-full glass-input"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-450 uppercase">Finalidade da Viagem</label>
                    <input 
                      type="text"
                      value={formPurpose}
                      onChange={(e) => setFormPurpose(e.target.value)}
                      placeholder="Ex: Coleta de amostras solo"
                      className="w-full glass-input"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2.5 border-t">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-450 uppercase">Litros Abastecido (Se houver)</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={formFuelFilled}
                      onChange={(e) => setFormFuelFilled(e.target.value)}
                      placeholder="Ex: 45.5"
                      className="w-full glass-input"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-450 uppercase">Custo Combustível R$ (Se houver)</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={formFuelCost}
                      onChange={(e) => setFormFuelCost(e.target.value)}
                      placeholder="Ex: 240.50"
                      className="w-full glass-input"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t">
                  <button type="button" onClick={() => { setIsLogTripOpen(false); resetTripForm(); }} className="px-4 py-2 border rounded-xl text-slate-500">
                    Cancelar
                  </button>
                  <button type="submit" disabled={saving} className="px-5 py-2 bg-emerald-600 text-white font-bold uppercase rounded-xl">
                    {saving ? 'Gravando...' : 'Gravar Diário de Km'}
                  </button>
                </div>

              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmationModal 
        isOpen={isDeleteVehicleId !== null}
        onClose={() => setIsDeleteVehicleId(null)}
        onConfirm={() => isDeleteVehicleId && handleDeleteVehicle(isDeleteVehicleId)}
        title="Retirar Veículo da Frota?"
        description="Esta ação removerá este veículo permanentemente do quadro operacional. Todas as viagens salvas permanecerão intocadas."
      />

    </div>
  );
}
