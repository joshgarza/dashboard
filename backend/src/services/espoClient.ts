interface EspoConfig {
  baseUrl: string;
  username: string;
  password: string;
}

interface EspoListResponse<T> {
  total: number;
  list: T[];
}

interface Opportunity {
  id: string;
  name: string;
  stage: string;
  accountId?: string;
  accountName?: string;
  amount?: number;
  probability?: number;
  closeDate?: string;
}

interface Account {
  id: string;
  name: string;
  website?: string;
  type?: string;
}

export async function fetchOpportunities(config: EspoConfig): Promise<EspoListResponse<Opportunity>> {
  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  const response = await fetch(`${config.baseUrl}/api/v1/Opportunity`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!response.ok) {
    throw new Error(`EspoCRM API error: ${response.status}`);
  }
  return response.json();
}

export async function fetchAccounts(config: EspoConfig): Promise<EspoListResponse<Account>> {
  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  const response = await fetch(`${config.baseUrl}/api/v1/Account`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!response.ok) {
    throw new Error(`EspoCRM API error: ${response.status}`);
  }
  return response.json();
}

export type { EspoConfig, Opportunity, Account };
