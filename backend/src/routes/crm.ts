import { Router, Request, Response, NextFunction } from 'express';
import { fetchOpportunities, fetchContacts, EspoConfig } from '../services/espoClient.js';

const router = Router();

function getEspoConfig(): EspoConfig {
  const baseUrl = process.env.ESPO_URL;
  const username = process.env.ESPO_USER;
  const password = process.env.ESPO_PASS;

  if (!baseUrl || !username || !password) {
    throw new Error('Missing EspoCRM configuration. Set ESPO_URL, ESPO_USER, and ESPO_PASS env vars.');
  }

  return { baseUrl, username, password };
}

router.get('/crm/contacts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = getEspoConfig();
    const contacts = await fetchContacts(config);

    const stages: Record<string, number> = {};
    for (const contact of contacts.list) {
      const stage = contact.cStatus || 'Unknown';
      stages[stage] = (stages[stage] || 0) + 1;
    }

    res.json({
      success: true,
      data: {
        total: contacts.total,
        stages,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/crm/pipeline', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = getEspoConfig();
    const opportunities = await fetchOpportunities(config);

    const stages: Record<string, number> = {};
    for (const opp of opportunities.list) {
      const stage = opp.stage || 'Unknown';
      stages[stage] = (stages[stage] || 0) + 1;
    }

    res.json({
      success: true,
      data: {
        total: opportunities.total,
        stages,
      },
    });
  } catch (err) {
    next(err);
  }
});

export { router as crmRouter };
