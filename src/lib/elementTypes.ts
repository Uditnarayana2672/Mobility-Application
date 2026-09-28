import {
  Luggage,
  ShieldCheck,
  PlaneTakeoff,
  Ban,
  Armchair,
  ShoppingBag,
  Utensils,
  Toilet,
  ArrowUpDown,
  TrendingUp,
  Package,
  Info,
  Landmark,
  Coins,
  HeartPulse,
  Hand,
  BatteryCharging,
  Baby,
  ShoppingCart,
  Droplet,
  Car,
  type LucideIcon,
} from 'lucide-react';

export interface AreaTypeConfig {
  id: string;
  label: string;
  color: string;
  icon: LucideIcon;
}

export const AIRPORT_AREA_TYPES: AreaTypeConfig[] = [
  { id: 'checkin', label: 'Check-in Counter', color: '#2563EB', icon: Luggage },
  { id: 'security', label: 'Security / Immigration', color: '#DC2626', icon: ShieldCheck },
  { id: 'gate', label: 'Boarding Gate', color: '#0D9488', icon: PlaneTakeoff },
  { id: 'restricted', label: 'Restricted Area', color: '#991B1B', icon: Ban },
  { id: 'lounge', label: 'Lounge', color: '#7C3AED', icon: Armchair },
  { id: 'shop', label: 'Shop', color: '#DB2777', icon: ShoppingBag },
  { id: 'eatery', label: 'Eatery', color: '#EA580C', icon: Utensils },
  { id: 'toilet', label: 'Toilet', color: '#0284C7', icon: Toilet },
  { id: 'elevator', label: 'Elevator', color: '#8E44AD', icon: ArrowUpDown },
  { id: 'escalator', label: 'Escalator', color: '#6D28D9', icon: TrendingUp },
  { id: 'baggage', label: 'Baggage Claim', color: '#475569', icon: Package },
];

export const AIRPORT_AREA_MAP: Record<string, AreaTypeConfig> = Object.fromEntries(
  AIRPORT_AREA_TYPES.map(t => [t.id, t])
);

export const DRAWABLE_TYPES = [
  'room', 'hallway', 'custom', 'entry', 'stairs', 'wall',
  ...AIRPORT_AREA_TYPES.map(t => t.id),
];

export const AIRPORT_POIS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'info', label: 'Information Desk', icon: Info },
  { id: 'atm', label: 'ATM', icon: Landmark },
  { id: 'currency', label: 'Currency Exchange', icon: Coins },
  { id: 'medical', label: 'Medical / First Aid', icon: HeartPulse },
  { id: 'prayer', label: 'Prayer Room', icon: Hand },
  { id: 'charging', label: 'Charging Station', icon: BatteryCharging },
  { id: 'babycare', label: 'Baby Care', icon: Baby },
  { id: 'trolley', label: 'Trolley Bay', icon: ShoppingCart },
  { id: 'drinkingwater', label: 'Drinking Water', icon: Droplet },
  { id: 'taxi', label: 'Taxi / Cab Counter', icon: Car },
];

export type FieldKind = 'text' | 'number' | 'boolean' | 'select' | 'list';

export interface AttributeField {
  key: string;
  label: string;
  kind: FieldKind;
  options?: string[];
}

export const COMMON_AIRPORT_FIELDS: AttributeField[] = [
  { key: 'zone', label: 'Zone', kind: 'select', options: ['landside', 'airside', 'restricted'] },
  { key: 'flightType', label: 'Flight Type', kind: 'select', options: ['domestic', 'international', 'common'] },
  { key: 'openingHours', label: 'Opening Hours', kind: 'text' },
  { key: 'accessible', label: 'Wheelchair Accessible', kind: 'boolean' },
];

export const TYPE_FIELDS: Record<string, AttributeField[]> = {
  checkin: [
    { key: 'role', label: 'Role', kind: 'select', options: ['island', 'counter', 'self-bag-drop', 'ticketing'] },
    { key: 'island', label: 'Island / Row', kind: 'text' },
    { key: 'counterNumber', label: 'Counter Number', kind: 'number' },
    { key: 'counterRange', label: 'Counter Range', kind: 'text' },
    { key: 'airlines', label: 'Airlines', kind: 'list' },
    { key: 'cabinClass', label: 'Cabin Class', kind: 'select', options: ['all', 'economy', 'business', 'premium'] },
    { key: 'bagDrop', label: 'Bag Drop', kind: 'boolean' },
  ],
  security: [
    { key: 'role', label: 'Role', kind: 'select', options: ['zone', 'lane', 'counter'] },
    { key: 'securityType', label: 'Check Type', kind: 'select', options: ['security', 'emigration', 'immigration', 'customs'] },
    { key: 'laneNumber', label: 'Lane Number', kind: 'number' },
    { key: 'counterNumber', label: 'Counter Number', kind: 'number' },
    { key: 'fastTrack', label: 'Fast Track', kind: 'boolean' },
    { key: 'digiYatra', label: 'DigiYatra', kind: 'boolean' },
    { key: 'authority', label: 'Authority', kind: 'text' },
  ],
  gate: [
    { key: 'gateNumber', label: 'Gate Number', kind: 'text' },
    { key: 'gateType', label: 'Gate Type', kind: 'select', options: ['contact', 'bus', 'remote'] },
    { key: 'aerobridge', label: 'Aerobridge', kind: 'boolean' },
  ],
  entry: [
    { key: 'gateNumber', label: 'Gate Number', kind: 'text' },
    { key: 'entryType', label: 'Entry Type', kind: 'select', options: ['departure-entry', 'arrival-exit', 'staff'] },
    { key: 'idCheck', label: 'ID Check', kind: 'boolean' },
    { key: 'digiYatra', label: 'DigiYatra', kind: 'boolean' },
  ],
  restricted: [
    { key: 'accessLevel', label: 'Access Level', kind: 'select', options: ['staff-only', 'airside-pass', 'cisf', 'customs', 'airline-crew'] },
    { key: 'authority', label: 'Authority', kind: 'text' },
    { key: 'reason', label: 'Reason', kind: 'text' },
  ],
  lounge: [
    { key: 'operator', label: 'Operator', kind: 'text' },
    { key: 'accessRules', label: 'Access Rules', kind: 'text' },
    { key: 'amenities', label: 'Amenities', kind: 'list' },
  ],
  shop: [
    { key: 'brand', label: 'Brand', kind: 'text' },
    { key: 'category', label: 'Category', kind: 'select', options: ['duty-free', 'retail', 'books', 'electronics', 'fashion', 'souvenirs', 'pharmacy', 'convenience'] },
  ],
  eatery: [
    { key: 'brand', label: 'Brand', kind: 'text' },
    { key: 'cuisine', label: 'Cuisine', kind: 'text' },
    { key: 'dietary', label: 'Dietary Options', kind: 'list' },
  ],
  toilet: [
    { key: 'gender', label: 'Gender', kind: 'select', options: ['male', 'female', 'unisex', 'accessible', 'family'] },
    { key: 'babyChanging', label: 'Baby Changing', kind: 'boolean' },
  ],
  elevator: [
    { key: 'liftId', label: 'Elevator ID', kind: 'text' },
    { key: 'servesFloors', label: 'Serves Floors', kind: 'list' },
  ],
  escalator: [
    { key: 'liftId', label: 'Escalator ID', kind: 'text' },
    { key: 'servesFloors', label: 'Serves Floors', kind: 'list' },
    { key: 'direction', label: 'Direction', kind: 'select', options: ['up', 'down', 'reversible'] },
  ],
  baggage: [
    { key: 'beltNumber', label: 'Belt Number', kind: 'number' },
  ],
};
