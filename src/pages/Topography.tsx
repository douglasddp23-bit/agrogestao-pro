import React, { useState, useEffect } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { Map, MapPin, Maximize, Compass, Layers, FileCheck, Save, User, CheckCircle2, ChevronRight, Info, Ruler, Satellite, Trash2, Plus, FileCode, Crosshair, Navigation, ChevronDown, ChevronUp, FileSpreadsheet, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { cn, safeUrl } from '../lib/utils';
import { toast } from 'sonner';
import { collection, onSnapshot, query, orderBy, addDoc, serverTimestamp, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Client } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { handleFirestoreError, OperationType, todayLocalDateString } from '../lib/utils';

import ConfirmationModal from '../components/ConfirmationModal';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { Map as PageIcon } from 'lucide-react';

export interface GPSPoint {
  id: string;
  name: string;
  type: 'boundary' | 'water' | 'obstacle' | 'building' | 'reference' | 'other';
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number;
  capturedAt: string;
}

type TopoServiceType = 'altimetry' | 'planimetry' | 'planialtimetry' | 'georeferencing' | 'demarcation' | 'subdivision';

interface TopoServiceOption {
  id: TopoServiceType;
  label: string;
  description: string;
  icon: any;
}

const TOPO_SERVICES: TopoServiceOption[] = [
  { id: 'altimetry', label: 'Altimetria', description: 'Nivelamento e curvas de nível', icon: Layers },
  { id: 'planimetry', label: 'Planimetria', description: 'Medição de perímetros e áreas', icon: Ruler },
  { id: 'planialtimetry', label: 'Planialtimetria', description: 'Levantamento completo (3D)', icon: Map },
  { id: 'georeferencing', label: 'Georreferenciamento', description: 'Certificação INCRA / SIGEF', icon: Satellite },
  { id: 'demarcation', label: 'Demarcação', description: 'Locação de divisas e piquetes', icon: MapPin },
  { id: 'subdivision', label: 'Desdobro/Loteamento', description: 'Divisão de áreas e glebas', icon: Maximize },
];

const getPointTypeLabel = (type: GPSPoint['type']) => {
  switch(type) {
    case 'boundary': return 'Marco de Divisa';
    case 'water': return 'Recurso Hídrico / Nascente';
    case 'obstacle': return 'Obstáculo / Árvore';
    case 'building': return 'Construção / Sede';
    case 'reference': return 'Ponto de Referência';
    default: return 'Outro';
  }
};

const exportPointsToKML = (serviceName: string, points: GPSPoint[]) => {
  let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${serviceName} - Pontos de Interesse</name>
    <description>Pontos georreferenciados gerados pelo AgroGestão Pro</description>
`;

  points.forEach(p => {
    kml += `    <Placemark>
      <name>${p.name}</name>
      <description>Tipo: ${getPointTypeLabel(p.type)} | Precisão: ${p.accuracy.toFixed(1)}m | Capturado em: ${new Date(p.capturedAt).toLocaleString()}</description>
      <Point>
        <coordinates>${p.longitude},${p.latitude},${p.altitude || 0}</coordinates>
      </Point>
    </Placemark>
`;
  });

  kml += `  </Document>
</kml>`;

  const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Topografia_${serviceName.replace(/\s+/g, '_')}_Pontos.kml`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success("Arquivo KML exportado para Google Earth!");
};

const exportPointsToCSV = (serviceName: string, points: GPSPoint[]) => {
  let csv = "Ponto,Latitude,Longitude,Altitude(m),Precisão(m),Categoria,Data_Captura\n";
  points.forEach(p => {
    csv += `"${p.name}",${p.latitude},${p.longitude},${p.altitude || ''},${p.accuracy.toFixed(2)},"${getPointTypeLabel(p.type)}","${p.capturedAt}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Topografia_${serviceName.replace(/\s+/g, '_')}_Coordenadas.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success("Planilha de Coordenadas (CSV) exportada!");
};

const renderRelativeMap = (points: GPSPoint[]) => {
  if (points.length === 0) return null;
  if (points.length === 1) {
    return (
      <svg className="w-full h-48 bg-slate-900/10 rounded-2xl border border-slate-200/50" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="4" className="fill-emerald-600 animate-pulse" />
        <text x="50" y="40" textAnchor="middle" className="text-[6px] fill-slate-700 font-bold">{points[0].name}</text>
      </svg>
    );
  }

  const lats = points.map(p => p.latitude);
  const lngs = points.map(p => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const latRange = maxLat - minLat || 0.0001;
  const lngRange = maxLng - minLng || 0.0001;

  const padding = 20;
  const width = 260;
  const height = 160;

  const getX = (lng: number) => {
    return padding + ((lng - minLng) / lngRange) * (width - 2 * padding);
  };

  const getY = (lat: number) => {
    return height - (padding + ((lat - minLat) / latRange) * (height - 2 * padding));
  };

  return (
    <div className="relative">
      <svg className="w-full h-48 bg-slate-950 rounded-2xl border border-slate-800 shadow-inner" viewBox={`0 0 ${width} ${height}`}>
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} className="stroke-slate-800 stroke-1 stroke-dasharray-[2,2]" />
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="stroke-slate-800 stroke-1 stroke-dasharray-[2,2]" />
        
        <polyline
          points={points.map(p => `${getX(p.longitude)},${getY(p.latitude)}`).join(' ')}
          className="fill-none stroke-emerald-500/40 stroke-1.5 stroke-dasharray-[4,4]"
        />

        {points.map((p, index) => {
          const x = getX(p.longitude);
          const y = getY(p.latitude);
          let color = "fill-emerald-500";
          if (p.type === 'boundary') color = "fill-amber-500";
          if (p.type === 'water') color = "fill-emerald-500";
          if (p.type === 'obstacle') color = "fill-rose-500";
          if (p.type === 'building') color = "fill-emerald-500";

          return (
            <g key={p.id}>
              <circle cx={x} cy={y} r="5" className={`${color} stroke-slate-950 stroke-1 hover:r-7 transition-all cursor-pointer`} />
              <text x={x} y={y - 8} textAnchor="middle" className="text-[7px] fill-slate-300 font-bold bg-slate-950/80 p-0.5 rounded">
                {p.name}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="absolute bottom-2 right-2 flex gap-1.5 text-[8px] font-bold text-slate-400 bg-slate-950/80 px-2 py-1 rounded border border-slate-800">
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span> Divisa</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Água</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span> Obstáculo</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Sede</span>
      </div>
    </div>
  );
};

export default function Topography() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [propertyName, setPropertyName] = useState('');
  const [availableProperties, setAvailableProperties] = useState<string[]>([]);
  const [showPropertySelect, setShowPropertySelect] = useState(false);
  const [areaSize, setAreaSize] = useState('');
  const [serviceType, setServiceType] = useState<TopoServiceType | null>(null);
  const [observations, setObservations] = useState('');
  const [scheduledDate, setScheduledDate] = useState(todayLocalDateString());
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // New fields - CORREÇÃO 3
  const [topoEquipment, setTopoEquipment] = useState('rtk_gnss');
  const [targetRepresentative, setTargetRepresentative] = useState('');
  const [technicalLicense, setTechnicalLicense] = useState('');
  const [serviceStatus, setServiceStatus] = useState('Planejado');
  const [mapReportUrl, setMapReportUrl] = useState('');

  // GPS State
  const [newServicePoints, setNewServicePoints] = useState<GPSPoint[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [tempCoords, setTempCoords] = useState<{lat: number, lng: number, alt: number | null, acc: number} | null>(null);
  const [tempPointName, setTempPointName] = useState('');
  const [tempPointType, setTempPointType] = useState<GPSPoint['type']>('boundary');
  const [expandedGpsServiceId, setExpandedGpsServiceId] = useState<string | null>(null);

  // Existing service GPS capturing state
  const [existingServicePointName, setExistingServicePointName] = useState('');
  const [existingServicePointType, setExistingServicePointType] = useState<GPSPoint['type']>('boundary');
  const [existingServiceCoords, setExistingServiceCoords] = useState<{lat: number, lng: number, alt: number | null, acc: number} | null>(null);
  const [isCapturingExisting, setIsCapturingExisting] = useState(false);

  // Trigger capture for NEW service
  const handleTriggerCaptureForNewService = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocalização não é suportada por este dispositivo.");
      return;
    }
    setIsCapturing(true);
    setTempCoords(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setTempCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          alt: position.coords.altitude,
          acc: position.coords.accuracy
        });
        setTempPointName(`Ponto ${newServicePoints.length + 1}`);
        setIsCapturing(false);
        toast.success("GPS sincronizado com sucesso!");
      },
      (error) => {
        setIsCapturing(false);
        let errorMsg = "Erro ao ler GPS.";
        if (error.code === error.PERMISSION_DENIED) {
          errorMsg = "Permissão de localização negada.";
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          errorMsg = "Sinal GPS indisponível.";
        } else if (error.code === error.TIMEOUT) {
          errorMsg = "Tempo esgotado ao buscar sinal GPS.";
        }
        toast.error(errorMsg);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handleAddTempPoint = () => {
    if (!tempCoords) return;
    const newPt: GPSPoint = {
      id: Math.random().toString(36).substring(2, 9),
      name: tempPointName || `Ponto ${newServicePoints.length + 1}`,
      type: tempPointType,
      latitude: tempCoords.lat,
      longitude: tempCoords.lng,
      altitude: tempCoords.alt,
      accuracy: tempCoords.acc,
      capturedAt: new Date().toISOString()
    };
    setNewServicePoints([...newServicePoints, newPt]);
    setTempCoords(null);
    setTempPointName('');
    toast.success(`Ponto "${newPt.name}" adicionado à lista!`);
  };

  // Trigger capture for EXISTING service
  const handleTriggerCaptureForExistingService = (pointsLength: number) => {
    if (!navigator.geolocation) {
      toast.error("Geolocalização não é suportada por este dispositivo.");
      return;
    }
    setIsCapturingExisting(true);
    setExistingServiceCoords(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setExistingServiceCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          alt: position.coords.altitude,
          acc: position.coords.accuracy
        });
        setExistingServicePointName(`Ponto ${pointsLength + 1}`);
        setIsCapturingExisting(false);
        toast.success("Coordenada móvel capturada!");
      },
      (error) => {
        setIsCapturingExisting(false);
        let errorMsg = "Erro ao obter GPS.";
        if (error.code === error.PERMISSION_DENIED) {
          errorMsg = "Acesso ao GPS negado.";
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          errorMsg = "Sinal de localização offline.";
        }
        toast.error(errorMsg);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handleAddPointToExistingService = async (serviceId: string, currentPoints: GPSPoint[], newPoint: Omit<GPSPoint, 'id' | 'capturedAt'>) => {
    try {
      const fullPoint: GPSPoint = {
        ...newPoint,
        id: Math.random().toString(36).substring(2, 9),
        capturedAt: new Date().toISOString()
      };
      
      const updatedPoints = [...currentPoints, fullPoint];
      
      await updateDoc(doc(db, 'topography_services', serviceId), {
        points: updatedPoints
      });
      
      toast.success(`Ponto "${fullPoint.name}" georreferenciado e salvo no projeto!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'topography_services');
    }
  };

  const handleDeletePointFromExistingService = async (serviceId: string, currentPoints: GPSPoint[], pointIdToDelete: string) => {
    try {
      const updatedPoints = currentPoints.filter(p => p.id !== pointIdToDelete);
      
      await updateDoc(doc(db, 'topography_services', serviceId), {
        points: updatedPoints
      });
      
      toast.success("Ponto de campo removido do projeto.");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'topography_services');
    }
  };

  useEffect(() => {
    const q = query(collection(db, 'clients'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setClients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'clients');
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'topography_services'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setServices(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'topography_services');
    });
    return unsubscribe;
  }, []);

  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId);
    const selectedClient = clients.find(c => c.id === clientId);
    
    if (selectedClient) {
      const properties = selectedClient.properties?.map(p => p.name) || [];
      setAvailableProperties(properties);
      
      if (properties.length === 1) {
        setPropertyName(properties[0]);
        setShowPropertySelect(false);
      } else if (properties.length > 1) {
        setPropertyName('');
        setShowPropertySelect(true);
      } else {
        setPropertyName('');
        setShowPropertySelect(false);
      }
    } else {
      setAvailableProperties([]);
      setShowPropertySelect(false);
      setPropertyName('');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !areaSize || !serviceType || !propertyName) {
      toast.error('Por favor, preencha todos os campos obrigatórios (Cliente, Propriedade, Área e Serviço).');
      return;
    }

    setIsSaving(true);
    try {
      const client = clients.find(c => c.id === selectedClientId);
      const serviceLabel = TOPO_SERVICES.find(s => s.id === serviceType)?.label || 'Topografia';
      
      const docRef = await addDoc(collection(db, 'topography_services'), {
        clientId: selectedClientId,
        clientName: client?.name || 'Cliente Desconhecido',
        propertyName,
        areaSize: parseFloat(areaSize),
        serviceType,
        serviceLabel,
        observations,
        scheduledDate,
        status: serviceStatus,
        createdAt: serverTimestamp(),
        createdBy: user?.uid,
        technicalResponsible: user?.displayName || 'Técnico da Empresa',
        topoEquipment,
        targetRepresentative,
        technicalLicense,
        mapReportUrl: mapReportUrl || null,
        points: newServicePoints
      });

      // Automatically integrate with Agenda by creating a notification
      if (user) {
        await addDoc(collection(db, 'notifications'), {
          userId: user.uid,
          title: 'Serviço Agendado na Agenda',
          message: `O serviço de ${serviceLabel} para ${client?.name} foi integrado à agenda para o dia ${scheduledDate.split('-').reverse().join('/')}.`,
          type: 'success',
          read: false,
          createdAt: new Date().toISOString(),
          link: '/agenda'
        });
      }
      
      setSaveSuccess(true);
      toast.success('Serviço de Topografia Registrado!', {
        description: `${serviceLabel} (${areaSize} ha) na propriedade ${propertyName} para o cliente ${client?.name || 'Cliente'}.`,
        duration: 5000,
      });
      setAreaSize('');
      setServiceType(null);
      setObservations('');
      setSelectedClientId('');
      setTargetRepresentative('');
      setTechnicalLicense('');
      setMapReportUrl('');
      setNewServicePoints([]);
      
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'topography_services');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteService = async (id: string) => {
    const removed = services.find((s: any) => s.id === id);
    // Remove da tela imediatamente, sem esperar o listener do Firestore.
    setServices((prev: any[]) => prev.filter((s: any) => s.id !== id));
    try {
      await deleteDoc(doc(db, 'topography_services', id));
      setIsDeleteModalOpen(null);
      toast.success('Serviço excluído com sucesso.');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'topography_services');
      // Reverte a remoção otimista se o servidor recusou.
      if (removed) {
        setServices((prev: any[]) => prev.some((s: any) => s.id === removed.id) ? prev : [...prev, removed]);
      }
    }
  };

  return (
    <div className="flex flex-col gap-8 h-full overflow-y-auto pr-2 pb-10">
      <header className={PAGE_HEADER_CLASS} data-page-header>
        <PageTitle icon={PageIcon} title="Topografia" subtitle="Levantamentos, medições e georreferenciamento" />
        
        <div className="px-4 py-2 bg-slate-50 text-slate-600 rounded-2xl text-[10px] font-bold uppercase tracking-widest border border-slate-100 hidden md:block">
           Módulo de Precision Mapping
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <form onSubmit={(e) => { e.preventDefault(); runExclusive('Topography.handleSave', () => handleSave(e)); }} className="space-y-8">
            <section className="glass-card p-8 space-y-6">
              <div className="flex items-center gap-2 mb-2">
                 <User className="w-5 h-5 text-slate-500" />
                 <h2 className="font-display font-bold text-slate-800">Identificação do Projeto</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cliente / Propriedade</label>
                    <select 
                      required
                      value={selectedClientId}
                      onChange={(e) => handleClientChange(e.target.value)}
                      className="w-full glass-input bg-white/50"
                    >
                      <option value="">Selecione um cliente...</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                 </div>

                 {showPropertySelect && (
                   <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Selecionar Propriedade</label>
                      <select 
                        required
                        value={propertyName}
                        onChange={(e) => setPropertyName(e.target.value)}
                        className="w-full glass-input bg-slate-50/30 border-slate-200"
                      >
                        <option value="">Escolha a propriedade...</option>
                        {availableProperties.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                   </div>
                 )}

                 {propertyName && !showPropertySelect && (
                   <div className="space-y-2 animate-in fade-in">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Propriedade Vinculada</label>
                      <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-100 rounded-2xl">
                         <Compass className="w-4 h-4 text-emerald-600" />
                         <span className="text-xs font-bold text-emerald-700">{propertyName}</span>
                         <span className="ml-auto text-[9px] font-bold text-emerald-500 uppercase">Auto</span>
                      </div>
                   </div>
                 )}

                 <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Área Estimada (Hectares)</label>
                    <div className="relative">
                       <input 
                         required
                         type="number"
                         step="0.01"
                         value={areaSize}
                         onChange={(e) => setAreaSize(e.target.value)}
                         placeholder="Ex: 45.5"
                         className="w-full glass-input bg-white/50 pr-12"
                       />
                       <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">ha</span>
                    </div>
                 </div>

                 <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Data Agendada de Execução</label>
                    <input 
                      required
                      type="date"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      className="w-full glass-input bg-slate-50/50 border-slate-200"
                    />
                 </div>
              </div>
            </section>

            <section className="glass-card p-8 space-y-6">
              <div className="flex items-center gap-2 mb-2">
                 <Layers className="w-5 h-5 text-slate-500" />
                 <h2 className="font-display font-bold text-slate-800">Tipo de Serviço Topográfico</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 {TOPO_SERVICES.map((service) => (
                   <button
                     key={service.id}
                     type="button"
                     onClick={() => setServiceType(service.id)}
                     className={cn(
                       "flex items-center gap-4 p-5 rounded-2xl border-2 transition-all text-left group",
                       serviceType === service.id 
                        ? "bg-emerald-600 border-emerald-600 text-white shadow-xl shadow-emerald-100 scale-[1.02]" 
                        : "bg-white/40 border-white/60 hover:bg-white/60 hover:border-slate-200"
                     )}
                   >
                     <div className={cn(
                       "p-3 rounded-xl transition-colors",
                       serviceType === service.id ? "bg-white/20 text-white" : "bg-white text-slate-500"
                     )}>
                        <service.icon className="w-5 h-5" />
                     </div>
                     <div>
                        <div className={cn("font-bold text-sm", serviceType === service.id ? "text-white" : "text-slate-700")}>{service.label}</div>
                        <div className={cn("text-[10px] font-medium leading-tight", serviceType === service.id ? "text-slate-100" : "text-slate-400")}>{service.description}</div>
                     </div>
                     {serviceType === service.id && (
                        <CheckCircle2 className="w-5 h-5 ml-auto text-white" />
                     )}
                   </button>
                 ))}
              </div>
            </section>

            {/* CORREÇÃO 3 - Detalhes Técnicos Extras */}
            <section className="glass-card p-8 space-y-6">
              <div className="flex items-center gap-2 mb-2">
                 <Compass className="w-5 h-5 text-slate-500" />
                 <h2 className="font-display font-bold text-slate-800">Parâmetros Técnicos & Credenciamento</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Equipamento de Levantamento</label>
                     <select
                       value={topoEquipment}
                       onChange={(e) => setTopoEquipment(e.target.value)}
                       className="w-full glass-input bg-white/50"
                     >
                       <option value="rtk_gnss">Receptor GNSS RTK</option>
                       <option value="estacao_total">Estação Total Óptica</option>
                       <option value="drone_laser">Drone UAV (Lidar / Fotogrametria)</option>
                       <option value="gps_geodesico">GPS Geodésico de Dupla Frequência</option>
                     </select>
                  </div>

                  <div className="space-y-2">
                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Profissional Credenciado</label>
                     <input
                       type="text"
                       placeholder="Ex: Eng. Agrimensor Carlos Mendes"
                       value={targetRepresentative}
                       onChange={(e) => setTargetRepresentative(e.target.value)}
                       className="w-full glass-input bg-white/50"
                     />
                  </div>

                  <div className="space-y-2">
                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">CREA / ART do Profissional</label>
                     <input
                       type="text"
                       placeholder="Ex: CREA-SP 50621458 / ART 2026-X"
                       value={technicalLicense}
                       onChange={(e) => setTechnicalLicense(e.target.value)}
                       className="w-full glass-input bg-white/50"
                     />
                  </div>

                  <div className="space-y-2">
                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status Inicial do Projeto</label>
                     <select
                       value={serviceStatus}
                       onChange={(e) => setServiceStatus(e.target.value)}
                       className="w-full glass-input bg-white/50"
                     >
                       <option value="Planejado">Planejado / Agendado</option>
                       <option value="Campo Concluído">Etapa de Campo Concluída</option>
                       <option value="Pós-Processamento">Pós-Processamento e Desenho</option>
                       <option value="Entregue">Laudo e Mapa Entregue</option>
                     </select>
                  </div>

                  <div className="space-y-2 md:col-span-2">
                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Link do Laudo / Mapa Final (Laudo URL)</label>
                     <input
                       type="url"
                       placeholder="Ex: https://drive.google.com/share-map-url"
                       value={mapReportUrl}
                       onChange={(e) => setMapReportUrl(e.target.value)}
                       className="w-full glass-input bg-white/50"
                     />
                  </div>
              </div>
            </section>

            <section className="glass-card p-8 space-y-4">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Observações Adicionais / Requisitos Técnicos</label>
              <textarea 
                rows={4}
                value={observations}
                onChange={(e) => setObservations(e.target.value)}
                placeholder="Descreva equipamentos necessários, urgência ou marcos de divisa existentes..."
                className="w-full glass-input bg-white/50"
              />
            </section>

            {/* GPS Mapping & Points of Interest (Opcional) */}
            <section className="glass-card p-8 space-y-6">
              <div className="flex items-center gap-2 mb-2">
                 <MapPin className="w-5 h-5 text-slate-500" />
                 <h2 className="font-display font-bold text-slate-800">Mapeamento GPS / Pontos de Interesse (Opcional)</h2>
              </div>
              
              {/* Capture Point Tool */}
              <div className="p-5 bg-slate-50/30 border border-slate-100 rounded-3xl space-y-4">
                 <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                       <Crosshair className="w-4 h-4 text-slate-500 animate-pulse" /> Capturar Coordenadas do Dispositivo
                    </span>
                    <span className="text-[9px] font-bold text-slate-400 bg-white/80 px-2 py-0.5 rounded border">Navegador GPS API</span>
                 </div>
                 
                 {/* Capture Trigger and Status */}
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                    <button
                       type="button"
                       disabled={isCapturing}
                       onClick={handleTriggerCaptureForNewService}
                       className="py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.98]"
                    >
                       {isCapturing ? (
                         <>
                           <Activity className="w-4 h-4 animate-spin" /> Buscando Sinal GPS...
                         </>
                       ) : (
                         <>
                           <Compass className="w-4 h-4" /> Capturar Ponto pelo GPS
                         </>
                       )}
                    </button>
                    
                    {tempCoords ? (
                      <div className="text-[11px] font-medium text-slate-600 bg-white/60 p-3 rounded-2xl border border-slate-200/50 space-y-0.5">
                         <div className="font-bold text-slate-600 flex items-center justify-between">
                            <span>Sinal Obtido!</span>
                            <span className={cn(
                              "text-[9px] px-1.5 py-0.5 rounded-full font-black uppercase",
                              tempCoords.acc < 5 ? "bg-emerald-100 text-emerald-800" :
                              tempCoords.acc < 15 ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"
                            )}>
                               Precisão: {tempCoords.acc.toFixed(1)}m
                            </span>
                         </div>
                         <div>Lat: <span className="font-mono font-bold text-slate-700">{tempCoords.lat.toFixed(6)}</span></div>
                         <div>Lng: <span className="font-mono font-bold text-slate-700">{tempCoords.lng.toFixed(6)}</span></div>
                         {tempCoords.alt !== null && <div>Alt: <span className="font-mono font-bold text-slate-700">{tempCoords.alt.toFixed(1)}m</span></div>}
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-400 font-medium leading-relaxed italic text-center md:text-left">
                         Aproxime-se do ponto físico no campo e clique para carregar as coordenadas de geolocalização.
                      </div>
                    )}
                 </div>

                 {tempCoords && (
                   <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-slate-100 animate-in fade-in duration-200">
                      <div className="space-y-1">
                         <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Identificador do Ponto</label>
                         <input 
                           type="text"
                           value={tempPointName}
                           onChange={(e) => setTempPointName(e.target.value)}
                           placeholder="Ex: Cerca Divisa"
                           className="w-full glass-input bg-white text-xs py-2 px-3"
                         />
                      </div>
                      <div className="space-y-1">
                         <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Categoria / Tipo</label>
                         <select 
                           value={tempPointType}
                           onChange={(e) => setTempPointType(e.target.value as any)}
                           className="w-full glass-input bg-white text-xs py-2 px-3"
                         >
                           <option value="boundary">Marco de Divisa</option>
                           <option value="water">Recurso Hídrico / Nascente</option>
                           <option value="obstacle">Obstáculo / Árvore</option>
                           <option value="building">Construção / Sede</option>
                           <option value="reference">Ponto de Referência</option>
                           <option value="other">Outro</option>
                         </select>
                      </div>
                      <div className="flex items-end">
                         <button
                           type="button"
                           onClick={handleAddTempPoint}
                           className="w-full py-2 px-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-1.5"
                         >
                            <Plus className="w-4 h-4" /> Adicionar Ponto
                         </button>
                      </div>
                   </div>
                 )}
              </div>

              {/* Temp Points List */}
              {newServicePoints.length > 0 && (
                <div className="space-y-4">
                   <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pontos Capturados para este Registro ({newServicePoints.length})</span>
                      <button
                        type="button"
                        onClick={() => setNewServicePoints([])}
                        className="text-[9px] font-bold text-rose-500 hover:underline uppercase"
                      >
                        Limpar Todos
                      </button>
                   </div>

                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="max-h-48 overflow-y-auto border border-slate-100 rounded-2xl bg-white/30 p-2 space-y-1.5">
                         {newServicePoints.map((p) => (
                            <div key={p.id} className="flex items-center justify-between p-2 bg-white/75 border border-slate-100 rounded-xl text-[11px]">
                               <div className="flex items-center gap-2">
                                  <div className={cn(
                                    "w-2.5 h-2.5 rounded-full",
                                    p.type === 'boundary' ? "bg-amber-500" :
                                    p.type === 'water' ? "bg-emerald-500" :
                                    p.type === 'obstacle' ? "bg-rose-500" :
                                    p.type === 'building' ? "bg-emerald-500" : "bg-emerald-500"
                                  )} />
                                  <div>
                                     <span className="font-bold text-slate-700">{p.name}</span>
                                     <span className="text-[9px] text-slate-400 ml-1.5 font-mono">{p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}</span>
                                  </div>
                               </div>
                               <button
                                 type="button"
                                 onClick={() => setNewServicePoints(newServicePoints.filter(pt => pt.id !== p.id))}
                                 className="text-slate-300 hover:text-rose-500 p-1"
                               >
                                  <Trash2 className="w-3.5 h-3.5" />
                               </button>
                            </div>
                         ))}
                      </div>
                      
                      {/* Mini Relative Plot Map */}
                      <div className="flex flex-col justify-center">
                         {renderRelativeMap(newServicePoints)}
                      </div>
                   </div>
                </div>
              )}
            </section>

            <div className="flex pt-4">
              <button 
                type={saveSuccess ? "button" : "submit"}
                disabled={isSaving || (user?.effectiveRole ?? user?.role) === 'staff' || (user?.effectiveRole ?? user?.role) === 'consultant'}
                onClick={() => {
                  if (saveSuccess) {
                    navigate('/agenda');
                  }
                }}
                className={cn(
                  "relative w-full py-5 rounded-3xl text-sm font-bold shadow-2xl transition-all flex items-center justify-center gap-3",
                  saveSuccess ? "bg-emerald-500 text-white shadow-emerald-100" : (((user?.effectiveRole ?? user?.role) === 'staff' || (user?.effectiveRole ?? user?.role) === 'consultant') ? "bg-slate-400 text-white cursor-not-allowed" : "bg-emerald-600 text-white shadow-emerald-100 hover:bg-emerald-700 active:scale-[0.98]"),
                  isSaving && "opacity-50 cursor-not-allowed"
                )}
              >
                {saveSuccess ? (
                  <div className="flex flex-col items-center gap-1">
                    <div className="flex items-center gap-2">
                       <CheckCircle2 className="w-5 h-5" /> Serviço Registrado com Sucesso!
                    </div>
                    <span className="text-[10px] opacity-80 font-medium">Clique para ver na Agenda</span>
                  </div>
                ) : (
                  <>
                    <Save className="w-5 h-5" /> {(user?.effectiveRole ?? user?.role) === 'staff' || (user?.effectiveRole ?? user?.role) === 'consultant' ? 'Apenas Leitura (Sem Permissão)' : (isSaving ? 'Registrando...' : 'Registrar Serviço Topográfico')}
                    {!((user?.effectiveRole ?? user?.role) === 'staff' || (user?.effectiveRole ?? user?.role) === 'consultant') && <ChevronRight className="w-4 h-4 ml-1 opacity-50" />}
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        <aside className="space-y-6">
          <div className="glass-card p-6 bg-slate-800 text-white border-none space-y-4">
             <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/20 rounded-lg">
                   <Info className="w-5 h-5 text-slate-400" />
                </div>
                <h3 className="font-bold">Diretrizes Técnicas</h3>
             </div>
             <p className="text-[11px] text-slate-400 leading-relaxed font-medium">
                Todo levantamento topográfico deve seguir as normas <strong>NBR 13.133</strong> e, em casos de georreferenciamento, a <strong>3ª Edição da NTGIR (INCRA)</strong>.
             </p>
             <ul className="text-[10px] text-slate-500 space-y-2 font-bold uppercase tracking-tighter">
                <li className="flex items-center gap-2"><div className="w-1 h-1 bg-emerald-500 rounded-full"></div> Tolerância de Erro Posicional</li>
                <li className="flex items-center gap-2"><div className="w-1 h-1 bg-emerald-500 rounded-full"></div> Datum Oficial (SIRGAS 2000)</li>
                <li className="flex items-center gap-2"><div className="w-1 h-1 bg-emerald-500 rounded-full"></div> Verificação de Redes de Apoio</li>
             </ul>
          </div>

          <div className="glass-card p-6 border-t-4 border-t-yellow-500">
             <h3 className="font-bold text-slate-700 flex items-center gap-2 mb-4">
                <FileCheck className="w-4 h-4 text-amber-500" /> Status do Módulo
             </h3>
             <div className="space-y-4">
                <div className="flex justify-between items-center">
                   <span className="text-[10px] font-bold text-slate-400 uppercase">Equipamento:</span>
                   <span className="text-[10px] font-bold text-emerald-600 uppercase">RTK GNSS Ativo</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                   <span className="text-[10px] font-bold text-slate-400 uppercase">Signal Correction:</span>
                   <span className="text-[10px] font-bold text-slate-500 uppercase">Ntrip Link OK</span>
                </div>
                <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2">
                   <div className="bg-emerald-500 h-full rounded-full w-4/5 shadow-sm shadow-emerald-100"></div>
                </div>
             </div>
          </div>
        </aside>

        {/* Recent Services List */}
        <section className="lg:col-span-3 glass-card p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-slate-500" />
              <h3 className="font-display font-bold text-slate-800 uppercase tracking-tight">Serviços Recentes</h3>
            </div>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Sincronizado com Agenda</span>
          </div>

          <div className="space-y-3">
            {services.length === 0 ? (
              <div className="text-center py-10 opacity-30">
                <Satellite className="w-10 h-10 mx-auto mb-2" />
                <p className="text-xs font-bold uppercase">Nenhum serviço registrado</p>
              </div>
            ) : (
              services.map(service => {
              const servicePoints = service.points || [];
              const isExpanded = expandedGpsServiceId === service.id;
              return (
                <div key={service.id} className="flex flex-col p-4 bg-white/40 border border-white/60 rounded-2xl group hover:border-slate-300 transition-all gap-2">
                  <div className="flex items-center justify-between gap-4 flex-wrap sm:flex-nowrap">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-slate-50 text-slate-600 rounded-xl">
                        {TOPO_SERVICES.find(s => s.id === service.serviceType)?.icon && React.createElement(TOPO_SERVICES.find(s => s.id === service.serviceType)!.icon, { className: "w-5 h-5" })}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-800">{service.clientName}</div>
                        <div className="text-[10px] text-slate-500 flex flex-wrap items-center gap-2 mt-0.5">
                          <span className="font-bold">{service.serviceLabel}</span>
                          <span className="w-1 h-1 bg-slate-300 rounded-full" />
                          <span>{service.propertyName}</span>
                          {service.areaSize && (
                            <>
                              <span className="w-1 h-1 bg-slate-300 rounded-full" />
                              <span className="font-bold text-slate-600">{service.areaSize} ha</span>
                            </>
                          )}
                          {service.topoEquipment && (
                            <>
                              <span className="w-1 h-1 bg-slate-300 rounded-full" />
                              <span className="text-[9px] font-bold text-slate-400 bg-slate-100/80 px-1.5 py-0.5 rounded border border-slate-200">
                                {service.topoEquipment === 'rtk_gnss' ? 'RTK GNSS' : 
                                 service.topoEquipment === 'estacao_total' ? 'Estação Total' :
                                 service.topoEquipment === 'drone_laser' ? 'Drone UAV' : 'GPS Geodésico'}
                              </span>
                            </>
                          )}
                          {service.targetRepresentative && (
                            <>
                              <span className="w-1 h-1 bg-slate-300 rounded-full" />
                              <span className="text-slate-400 italic">Resp: {service.targetRepresentative}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 ml-auto sm:ml-0">
                      <div className="text-right flex flex-col items-end gap-1">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                          Execução: {service.scheduledDate?.split('-').reverse().join('/')}
                        </span>
                        <div className={cn(
                          "px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border",
                          service.status === 'Entregue' ? "bg-emerald-50 text-emerald-700 border-emerald-100" :
                          service.status === 'Pós-Processamento' ? "bg-amber-50 text-amber-700 border-amber-100" :
                          service.status === 'Campo Concluído' ? "bg-slate-50 text-slate-700 border-slate-100" :
                          "bg-slate-50 text-slate-600 border-slate-100"
                        )}>
                          {service.status || 'Planejado'}
                        </div>
                      </div>
                      <button 
                        onClick={() => setExpandedGpsServiceId(isExpanded ? null : service.id)}
                        className={cn(
                          "py-1.5 px-3 rounded-xl border text-[10px] font-black uppercase tracking-wider flex items-center gap-1 shadow-sm transition-all cursor-pointer",
                          isExpanded 
                            ? "bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700" 
                            : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                        )}
                        title="Mapeamento GPS / Pontos"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        GPS ({servicePoints.length})
                      </button>
                      {service.mapReportUrl && (
                        <a 
                          href={safeUrl(service.mapReportUrl)} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="py-1.5 px-3 bg-emerald-50 text-emerald-705 rounded-xl border border-emerald-200 text-[10px] font-black uppercase tracking-wider hover:bg-emerald-100 flex items-center gap-1 shadow-sm transition-all"
                        >
                          <FileCheck className="w-3.5 h-3.5" />
                          Mapa
                        </a>
                      )}
                      {!((user?.effectiveRole ?? user?.role) === 'staff' || (user?.effectiveRole ?? user?.role) === 'consultant') && (
                        <button 
                          onClick={() => setIsDeleteModalOpen(service.id)}
                          className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded GPS points and capture drawer */}
                  {isExpanded && (
                    <div className="mt-4 p-5 bg-slate-50 border border-slate-100 rounded-2xl animate-in slide-in-from-top-2 duration-300 space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                         <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase">
                            <Compass className="w-4 h-4 text-slate-500 animate-pulse" /> Mapeamento GPS Móvel & Coordenadas
                         </h4>
                         <div className="flex gap-1.5">
                            <button 
                              onClick={() => exportPointsToKML(service.clientName + '_' + service.propertyName, servicePoints)}
                              disabled={servicePoints.length === 0}
                              className="py-1 px-2.5 bg-slate-200 hover:bg-slate-300 disabled:opacity-40 text-slate-700 rounded-lg text-[9px] font-black uppercase tracking-wider flex items-center gap-1 cursor-pointer transition-all"
                            >
                               <FileCode className="w-3 h-3 text-rose-500" /> KML (Earth)
                            </button>
                            <button 
                              onClick={() => exportPointsToCSV(service.clientName + '_' + service.propertyName, servicePoints)}
                              disabled={servicePoints.length === 0}
                              className="py-1 px-2.5 bg-slate-200 hover:bg-slate-300 disabled:opacity-40 text-slate-700 rounded-lg text-[9px] font-black uppercase tracking-wider flex items-center gap-1 cursor-pointer transition-all"
                            >
                               <FileSpreadsheet className="w-3 h-3 text-emerald-600" /> CSV (CAD)
                            </button>
                         </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                         {/* 1. Points List */}
                         <div className="lg:col-span-1 space-y-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-sans">Pontos Salvos ({servicePoints.length})</span>
                            {servicePoints.length === 0 ? (
                              <div className="text-center py-10 border border-dashed border-slate-200 rounded-xl bg-white/50 text-[10px] text-slate-400 italic font-medium">
                                 Nenhum ponto de campo cadastrado para este serviço.
                              </div>
                            ) : (
                              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                                 {servicePoints.map((p: GPSPoint) => (
                                    <div key={p.id} className="p-2 bg-white border border-slate-100 rounded-xl flex items-center justify-between text-[11px] hover:border-slate-200 transition-all">
                                       <div className="flex items-center gap-2">
                                          <div className={cn(
                                             "w-2 h-2 rounded-full",
                                             p.type === 'boundary' ? "bg-amber-500" :
                                             p.type === 'water' ? "bg-emerald-500" :
                                             p.type === 'obstacle' ? "bg-rose-500" :
                                             p.type === 'building' ? "bg-emerald-500" : "bg-emerald-500"
                                          )} />
                                          <div>
                                             <span className="font-bold text-slate-700">{p.name}</span>
                                             <div className="text-[9px] text-slate-400 font-mono mt-0.5">{p.latitude.toFixed(6)}, {p.longitude.toFixed(6)}</div>
                                          </div>
                                       </div>
                                       <button 
                                         onClick={() => {
                                           if ((user?.effectiveRole ?? user?.role) === 'staff' || (user?.effectiveRole ?? user?.role) === 'consultant') return;
                                           handleDeletePointFromExistingService(service.id, servicePoints, p.id);
                                         }}
                                         className={cn(
                                           "p-1",
                                           ((user?.effectiveRole ?? user?.role) === 'staff' || (user?.effectiveRole ?? user?.role) === 'consultant') ? "text-slate-200 cursor-not-allowed opacity-45" : "text-slate-300 hover:text-rose-500"
                                         )}
                                       >
                                          <Trash2 className="w-3.5 h-3.5" />
                                       </button>
                                    </div>
                                 ))}
                              </div>
                            )}
                         </div>

                         {/* 2. Interactive Relative Map Plot */}
                         <div className="lg:col-span-1 space-y-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Croqui Relativo de Pontos (SVG)</span>
                            {servicePoints.length === 0 ? (
                              <div className="w-full h-48 border border-dashed border-slate-200 rounded-2xl bg-white/50 flex flex-col items-center justify-center text-[10px] text-slate-400 italic p-4 text-center">
                                 Adicione pelo menos 2 pontos para renderizar o desenho relativo de divisa.
                              </div>
                            ) : (
                              renderRelativeMap(servicePoints)
                            )}
                         </div>

                         {/* 3. Field Capture Form */}
                         <div className="lg:col-span-1 bg-white/80 border border-slate-200 p-4 rounded-2xl space-y-3 shadow-sm">
                            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block flex items-center gap-1">
                               <Crosshair className="w-3.5 h-3.5 animate-pulse" /> Capturar Novo Ponto GPS
                            </span>

                            {existingServiceCoords ? (
                              <div className="space-y-3 animate-in fade-in duration-200">
                                 <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-[10px] font-mono text-slate-600 space-y-0.5">
                                    <div className="font-bold text-slate-600 flex justify-between font-sans mb-1 text-[11px]">
                                       <span>Coordenadas Obtidas</span>
                                       <span>Precisão: {existingServiceCoords.acc.toFixed(1)}m</span>
                                    </div>
                                    <div>Lat: {existingServiceCoords.lat.toFixed(6)}</div>
                                    <div>Lng: {existingServiceCoords.lng.toFixed(6)}</div>
                                    {existingServiceCoords.alt !== null && <div>Alt: {existingServiceCoords.alt.toFixed(1)}m</div>}
                                 </div>

                                 <div className="space-y-2">
                                    <div className="space-y-1">
                                       <label className="text-[9px] font-bold text-slate-400 uppercase">Nome do Ponto</label>
                                       <input 
                                         type="text"
                                         value={existingServicePointName}
                                         onChange={(e) => setExistingServicePointName(e.target.value)}
                                         placeholder="Ex: Marco M3"
                                         className="w-full glass-input bg-white text-xs py-1.5 px-2.5"
                                       />
                                    </div>
                                    <div className="space-y-1">
                                       <label className="text-[9px] font-bold text-slate-400 uppercase">Categoria</label>
                                       <select 
                                         value={existingServicePointType}
                                         onChange={(e) => setExistingServicePointType(e.target.value as any)}
                                         className="w-full glass-input bg-white text-xs py-1.5 px-2.5"
                                       >
                                         <option value="boundary">Marco de Divisa</option>
                                         <option value="water">Recurso Hídrico / Nascente</option>
                                         <option value="obstacle">Obstáculo / Árvore</option>
                                         <option value="building">Construção / Sede</option>
                                         <option value="reference">Ponto de Referência</option>
                                         <option value="other">Outro</option>
                                       </select>
                                    </div>
                                 </div>

                                 <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        handleAddPointToExistingService(service.id, servicePoints, {
                                          name: existingServicePointName || `Ponto ${servicePoints.length + 1}`,
                                          type: existingServicePointType,
                                          latitude: existingServiceCoords.lat,
                                          longitude: existingServiceCoords.lng,
                                          altitude: existingServiceCoords.alt,
                                          accuracy: existingServiceCoords.acc
                                        });
                                        setExistingServiceCoords(null);
                                        setExistingServicePointName('');
                                      }}
                                      className="flex-1 py-1.5 px-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl text-xs text-center cursor-pointer transition-all"
                                    >
                                       Salvar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setExistingServiceCoords(null)}
                                      className="py-1.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-500 font-bold rounded-xl text-xs text-center cursor-pointer transition-all"
                                    >
                                       Cancelar
                                    </button>
                                 </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                disabled={isCapturingExisting || (user?.effectiveRole ?? user?.role) === 'staff' || (user?.effectiveRole ?? user?.role) === 'consultant'}
                                onClick={() => {
                                  if ((user?.effectiveRole ?? user?.role) === 'staff' || (user?.effectiveRole ?? user?.role) === 'consultant') return;
                                  handleTriggerCaptureForExistingService(servicePoints.length);
                                }}
                                className={cn(
                                  "w-full py-4 px-4 text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all",
                                  ((user?.effectiveRole ?? user?.role) === 'staff' || (user?.effectiveRole ?? user?.role) === 'consultant') ? "bg-slate-300 text-slate-500 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-700 cursor-pointer"
                                )}
                              >
                                 {isCapturingExisting ? (
                                    <>
                                       <Activity className="w-4 h-4 animate-spin" /> Localizando...
                                    </>
                                 ) : (
                                    <>
                                       <Crosshair className="w-4 h-4" /> Capturar Posição Atual
                                    </>
                                 )}
                              </button>
                            )}
                         </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
            )}
          </div>
        </section>
      </div>

      <ConfirmationModal
        isOpen={!!isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(null)}
        onConfirm={() => isDeleteModalOpen && handleDeleteService(isDeleteModalOpen)}
        title="Excluir Serviço Topográfico?"
        description="Esta ação não pode ser desfeita. O serviço de topografia e seu agendamento serão removidos permanentemente."
        confirmLabel="Confirmar Exclusão"
      />
    </div>
  );
}
