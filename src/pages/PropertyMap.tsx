import React, { useState, useEffect } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { 
  MapPin, 
  Search, 
  Plus, 
  Trash2, 
  Layers, 
  Upload, 
  Globe, 
  Grid, 
  Compass, 
  Info,
  CheckCircle2,
  AlertCircle,
  FileDown
} from 'lucide-react';
import { collection, onSnapshot, query, updateDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { Client, Property } from '../types';

import { MapContainer, TileLayer, Polygon, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

import toGeoJSON from '@mapbox/togeojson';
import shp from 'shpjs';

// Fix icon paths
// @ts-ignore
import iconMarker from 'leaflet/dist/images/marker-icon.png';
// @ts-ignore
import iconRetina from 'leaflet/dist/images/marker-icon-2x.png';
// @ts-ignore
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
  iconUrl: iconMarker,
  iconRetinaUrl: iconRetina,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

// Helper to update map camera center smoothly
function ChangeView({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
}

export default function PropertyMap() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  // Selector
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedPropertyIdx, setSelectedPropertyIdx] = useState<number>(-1);

  // Map settings
  const [mapCenter, setMapCenter] = useState<[number, number]>([-12.5, -55.5]); // standard BR main agro states
  const [mapZoom, setMapZoom] = useState(5);
  const [basemap, setBasemap] = useState<'streets' | 'satellite'>('streets');

  // Parsed Uploaded Spatial Polygon Boundary State
  const [uploadedPolygons, setUploadedPolygons] = useState<{ lat: number; lng: number }[][]>([]);
  const [uploadedFileName, setUploadedFileName] = useState('');

  // Fetch Clients & Properties
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'clients'), (snapshot) => {
      setClients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
      setLoading(false);
    }, (e) => {
      console.error(e);
      toast.error('Erro ao listar propriedades.');
      setLoading(false);
    });
    return unsub;
  }, []);

  const selectedClient = clients.find(c => c.id === selectedClientId);
  const selectedProperty = selectedClient?.properties?.[selectedPropertyIdx];

  // Auto adjusting map center on property select
  useEffect(() => {
    if (selectedProperty && selectedProperty.latitude && selectedProperty.longitude) {
      setMapCenter([selectedProperty.latitude, selectedProperty.longitude]);
      setMapZoom(14);
      setUploadedPolygons([]); // reset custom uploads
      setUploadedFileName('');
    }
  }, [selectedPropertyIdx, selectedClientId]);

  // Client-side parser for GeoJSON, KML or Shapefile zip!
  const handleUploadSpatialFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedProperty) {
      toast.error("Por favor, selecione uma propriedade rústica para vincular as coordenadas.");
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = (file.name || '').toLowerCase();
    setUploadedFileName(file.name);

    try {
      const reader = new FileReader();

      if (fileName.endsWith('.kml')) {
        reader.onload = async (event) => {
          const text = event.target?.result as string;
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(text, 'text/xml');
          const geoJson = toGeoJSON.kml(xmlDoc);
          parseAndSetPolygons(geoJson);
        };
        reader.readAsText(file);
      } else if (fileName.endsWith('.geojson') || fileName.endsWith('.json')) {
        reader.onload = async (event) => {
          const text = event.target?.result as string;
          const geoJson = JSON.parse(text);
          parseAndSetPolygons(geoJson);
        };
        reader.readAsText(file);
      } else if (fileName.endsWith('.zip')) {
        // Zip file parser for shp files
        reader.onload = async (event) => {
          const buffer = event.target?.result as ArrayBuffer;
          const geoJson = await shp(buffer);
          parseAndSetPolygons(geoJson);
        };
        reader.readAsArrayBuffer(file);
      } else {
        toast.error("Formato de arquivo não suportado. Favor enviar .kml, .geojson ou Shapefile (.zip).");
      }
    } catch (err: any) {
      console.error(err);
      toast.error("Erro ao analisar arquivo espacial: " + err.message);
    }
  };

  // Extract coordinates from standard GeoJSON MultiPolygons/Polygons
  const parseAndSetPolygons = (geoJson: any) => {
    const polys: { lat: number; lng: number }[][] = [];
    
    // Safely iterate features
    const features = geoJson.features || (Array.isArray(geoJson) ? geoJson : [geoJson]);
    
    features.forEach((feat: any) => {
      const geom = feat.geometry || feat;
      if (!geom) return;

      if (geom.type === 'Polygon') {
        const ring = geom.coordinates[0];
        const ringCoords = ring.map((c: any) => ({ lat: c[1], lng: c[0] }));
        polys.push(ringCoords);
      } else if (geom.type === 'MultiPolygon') {
        geom.coordinates.forEach((polygonRing: any) => {
          const ring = polygonRing[0];
          const ringCoords = ring.map((c: any) => ({ lat: c[1], lng: c[0] }));
          polys.push(ringCoords);
        });
      }
    });

    if (polys.length > 0) {
      setUploadedPolygons(polys);
      // Auto centers camera around the first parsed coordinate
      setMapCenter([polys[0][0].lat, polys[0][0].lng]);
      setMapZoom(15);
      toast.success(`Carregado com sucesso: ${polys.length} polígono(s) mapeado(s)!`);
    } else {
      toast.warning("Nenhum polígono ou coordenada de demarcação detectada no arquivo.");
    }
  };

  // Mark drawing boundary and persistent save inside selected property list
  const handleSaveBoundaryToClient = async () => {
    if (!selectedClient || selectedPropertyIdx === -1 || uploadedPolygons.length === 0) return;

    try {
      const updatedProperties = [...selectedClient.properties];
      // Convert polygons coordinates to simple serializable objects
      const boundaryJSONString = JSON.stringify(uploadedPolygons);

      // Save custom geometric boundary text within property entry
      updatedProperties[selectedPropertyIdx] = {
        ...updatedProperties[selectedPropertyIdx],
        boundaryCoords: boundaryJSONString
      } as any;

      await updateDoc(doc(db, 'clients', selectedClient.id), {
        properties: updatedProperties
      });

      toast.success("Demarcação geométrica da fazenda gravada permanentemente no Firestore!");
    } catch (e) {
      console.error(e);
      toast.error("Falha ao salvar demarcação no bando de dados.");
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Title banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm animate-fadeIn">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-slate-100 text-slate-700 rounded-xl flex items-center justify-center">
            <MapPin className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-slate-800">Mapa Georreferenciado</h1>
            <p className="text-sm text-slate-500">Delimição de divisas rurais, análise de relevos por satélite e uploads KML/Shapefile</p>
          </div>
        </div>

        {/* Change basemap rendering style */}
        <div className="flex bg-slate-100 p-0.5 rounded-xl border">
          <button 
            onClick={() => setBasemap('streets')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
              basemap === 'streets' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-505 hover:text-slate-700'
            }`}
          >
            <Compass className="w-4 h-4" /> Ruas / Mapa
          </button>
          <button 
            onClick={() => setBasemap('satellite')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
              basemap === 'satellite' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-550 hover:text-slate-700'
            }`}
          >
            <Globe className="w-4 h-4" /> Satélite
          </button>
        </div>
      </div>

      {/* Selector controls Bar */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        <div className="md:col-span-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
            <Grid className="w-4 h-4 text-emerald-600" /> Escolha a Área Rural
          </h3>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Produtor / Cliente</label>
              <select
                value={selectedClientId}
                onChange={(e) => {
                  setSelectedClientId(e.target.value);
                  setSelectedPropertyIdx(-1);
                }}
                className="w-full glass-input text-xs h-10 py-1"
              >
                <option value="">Selecione o Cliente</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {selectedClient && selectedClient.properties && (
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Selecione a Propriedade</label>
                <select
                  value={selectedPropertyIdx}
                  onChange={(e) => setSelectedPropertyIdx(parseInt(e.target.value))}
                  className="w-full glass-input text-xs h-10 py-1"
                >
                  <option value="-1">Selecione a Propriedade</option>
                  {selectedClient.properties.map((p, idx) => (
                    <option key={idx} value={idx}>{p.name} {p.areaHectares ? `(${p.areaHectares} ha)` : ''}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Details metadata regarding chosen property */}
          {selectedProperty ? (
            <div className="pt-4 border-t space-y-3.5">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5 text-xs">
                {selectedProperty.areaHectares ? (
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Área Declarada</span>
                    <span className="font-bold text-slate-700">{selectedProperty.areaHectares} Hectares</span>
                  </div>
                ) : null}
                {selectedProperty.latitude && (
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Coordenadas Sede</span>
                    <span className="font-mono text-[10px] text-slate-500">{selectedProperty.latitude.toFixed(6)}, {selectedProperty.longitude?.toFixed(6)}</span>
                  </div>
                )}
              </div>

              {/* Upload Polygon Boundaries (KML/Shapefile Zip/GeoJSON) */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">Importar Limite Espacial (Boundary)</span>
                
                <div className="border border-dashed p-4 rounded-xl text-center cursor-pointer hover:bg-slate-50/50 relative">
                  <input 
                    type="file" 
                    accept=".kml,.geojson,.json,.zip"
                    onChange={handleUploadSpatialFile}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  <Upload className="w-5 h-5 text-slate-400 mx-auto mb-1.5" />
                  <span className="text-[10px] font-bold text-slate-600 block">Georreferenciamento (.kml, .json, .zip)</span>
                </div>
                {uploadedFileName && (
                  <div className="p-2 bg-emerald-50 text-emerald-800 rounded border border-emerald-100 flex items-center justify-between text-[10px]">
                    <span className="truncate">{uploadedFileName}</span>
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  </div>
                )}
              </div>

              {uploadedPolygons.length > 0 && (
                <button
                  onClick={() => runExclusive('PropertyMap.handleSaveBoundaryToClient', () => handleSaveBoundaryToClient())}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase rounded-xl transition-all"
                >
                  Gravar Fronteira Geométrica
                </button>
              )}

            </div>
          ) : (
            <div className="p-4 bg-slate-50 rounded-xl border border-dashed flex items-start gap-2.5 text-xs text-slate-400">
              <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <p>Escolha um produtor rural e uma propriedade para focar a câmera espacial e carregar demarcações georreferenciadas do terreno.</p>
            </div>
          )}

        </div>

        {/* Display Canvas Frame (Leaflet) */}
        <div className="md:col-span-8 bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm h-[500px] relative font-sans z-0">
          <MapContainer 
            center={mapCenter} 
            zoom={mapZoom} 
            style={{ width: '100%', height: '100%', outline: 'none' }}
          >
            {basemap === 'streets' ? (
              <TileLayer
                attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
            ) : (
              <TileLayer
                attribution='Map data &copy; <a href="https://zoom.earth">Zoom Earth</a>'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              />
            )}

            <ChangeView center={mapCenter} zoom={mapZoom} />

            {/* If property is selected and has GPS mark, render marker */}
            {selectedProperty && selectedProperty.latitude && selectedProperty.longitude && (
              <Marker position={[selectedProperty.latitude, selectedProperty.longitude]}>
                <Popup>
                  <span className="font-bold">{selectedProperty.name}</span> <br /> Sede da fazenda
                </Popup>
              </Marker>
            )}

            {/* If client boundary coords parsed, render polygon border */}
            {uploadedPolygons.length > 0 && uploadedPolygons.map((ring, idx) => (
              <Polygon 
                key={idx} 
                positions={ring.map(c => [c.lat, c.lng])} 
                pathOptions={{ color: 'emerald', fillColor: 'emerald', fillOpacity: 0.15, weight: 3 }}
              />
            ))}

            {/* Fallback boundary stored in selectedProperty string */}
            {selectedProperty && (selectedProperty as any).boundaryCoords && (
              <Polygon
                positions={JSON.parse((selectedProperty as any).boundaryCoords).map((ring: any) => 
                  ring.map((c: any) => [c.lat, c.lng])
                )}
                pathOptions={{ color: 'blue', fillColor: 'blue', fillOpacity: 0.12, weight: 3 }}
              />
            )}
          </MapContainer>
        </div>

      </div>

    </div>
  );
}
