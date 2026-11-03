import { AppRole } from './domain';

export interface Invitation {
  id: string;
  org_id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED';
  created_at: string;
  accepted_at: string | null;
}
