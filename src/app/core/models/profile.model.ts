import { AppRole } from './domain';

export interface Profile {
  id: string;
  org_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: AppRole;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/** Datos mínimos de un usuario para selects de "responsable". */
export type StaffMember = Pick<Profile, 'id' | 'full_name' | 'role' | 'active'>;
