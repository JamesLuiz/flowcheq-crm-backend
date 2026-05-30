import { createApp } from './app';
import { config } from './config';
import { connectMongo } from './store/mongo';

async function main() {
  await connectMongo();
  const app = createApp();
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[Flowcheq Backend] http://0.0.0.0:${config.port}`);
  });
}

main().catch((err) => {
  console.error('[Flowcheq Backend] Failed to start:', err);
  process.exit(1);
});
