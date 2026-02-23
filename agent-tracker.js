// Simple OpenCode Agent Tracker Plugin
// This is a minimal plugin that will pass validation

import { LMDBDatabase } from './dist/lmdb-database.js';
import { TrackingService } from './dist/tracking-service.js';
import { EnvProtection } from './dist/env-protection.js';

export default async function({ client }) {
  console.log('Agent Tracker Plugin loaded');
  
  const db = new LMDBDatabase();
  const trackingService = new TrackingService(db, client);
  const envProtection = new EnvProtection();
  
  return {
    'session.created': async (session) => {
      console.log('Session created:', session.id);
      await trackingService.initializeSessionTracking(session);
    },
    
    'tool.execute.before': async (input) => {
      await envProtection.handleToolBefore(input);
    },
    
    'tool.execute.after': async (input, output) => {
      if (output.success) {
        await trackingService.trackToolUsage(input, output);
      }
    }
  };
}