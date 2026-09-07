// Real, isolated PostgreSQL authority; Base44/Stripe remain synthetic adapters.
// This proves stored-function behavior, not deployed Base44 mirror semantics.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createMission1Authority, hashReservationToken } from '../../base44/shared/mission1Authority.js';
import { projectMission1Operation } from '../../base44/shared/mission1Projector.js';
import { applyReservationTuple } from '../../base44/shared/tupleTransition.js';

const clients = [];
export async function closeMission1Databases() {
  await Promise.all(clients.splice(0).map(client => client.end()));
}
export function attachMission1Postgres(deps) {
  if (!process.env.PG_MISSION1_SOCKET) return deps;
  let ready;
  const rows = name => { const store = deps._state.stores[name]; return Array.isArray(store) ? store : [...store.values()]; };
  async function connect() {
    const socket = process.env.PG_MISSION1_SOCKET;
    if (!socket.includes('/pg-m1-') || !socket.startsWith('/')) throw new Error('LOCAL_SOCKET_REQUIRED');
    const { default: pg } = await import(pathToFileURL(join(process.env.PG_MISSION1_RUNTIME, 'node_modules/pg/lib/index.js')));
    const config = { host: socket, port: 55439, user: 'postgres', password: 'local_synthetic_only' };
    const admin = new pg.Client({ ...config, database: 'postgres' }); await admin.connect();
    const database = `m1_${crypto.randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE DATABASE ${database} TEMPLATE mission1_template`); await admin.end();
    const client = new pg.Client({ ...config, database }); await client.connect(); clients.push(client);
    const stores = Object.fromEntries(Object.entries(deps._state.stores).map(([key, rows]) =>
      [key, Array.isArray(rows) ? rows : [...rows.values()]]));
    for (const listing of stores.Listing) {
      const lp = stores.ListingPrivate.find(row => row.listing_id === listing.id);
      const buyer = stores.User.find(row => row.email === listing.reserved_by_email)?.id || 'user_buyer';
      const seller = stores.User.find(row => row.email === listing.seller_email)?.id || 'user_seller';
      const reserved = !!listing.reservation_token;
      await client.query(`INSERT INTO authority_v1.reservation_authority(listing_id,seller_user_id,lifecycle_state,
        buyer_user_id,reservation_token_hash,reservation_expires_at,reservation_revision)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [listing.id,seller,reserved?'reserved':'available',reserved?buyer:null,
        reserved?await hashReservationToken(listing.reservation_token):null,reserved?listing.reservation_expires_at:null,listing.reservation_revision || (reserved?'initial':null)]);
      for (const pp of stores.PurchasePrivate.filter(row => row.listing_id === listing.id && row.payment_intent_id)) {
        await client.query(`INSERT INTO authority_v1.reservation_payment_bindings(purchase_id,payment_intent_id,listing_id,
          buyer_user_id,authority_version,reservation_revision,reservation_token_hash,capture_state)
          VALUES($1,$2,$3,$4,0,$5,$6,$7)`,[pp.purchase_id,pp.payment_intent_id,listing.id,buyer,listing.reservation_revision || 'initial',
          await hashReservationToken(pp.reservation_token || ''),pp.payment_captured?'captured':'authorized']);
      }
      void lp;
    }
    return { client, config, database };
  }
  const sql = async (query, args) => {
    ready ||= connect();
    const { client } = await ready;
    return (await client.query(query, args)).rows;
  };
  deps._mission1 = {
    sql,
    async independentConnection() {
      ready ||= connect(); const { config, database } = await ready;
      const { default: pg } = await import(pathToFileURL(join(process.env.PG_MISSION1_RUNTIME, 'node_modules/pg/lib/index.js')));
      const client = new pg.Client({ ...config, database }); await client.connect(); clients.push(client); return client;
    },
  };
  deps.paymentAuthority = createMission1Authority({ executor: sql, recorder: sql, worker: sql });
  // Checkout exercises the real ordered worker, even in older orchestration suites.
  deps.projectCheckout = op => projectMission1Operation({ ...deps, entities: { ...deps.entities,
    SeatInventory: deps.entities.SeatInventory || { filter: async () => [] } } }, op);
  deps.projectFailure = async context => {
    const lp = rows('ListingPrivate').find(row => row.listing_id === context.listing_id);
    if (lp) { lp.recovery_blocked = true; lp.cleanup_purchase_id = context.purchase_id; }
    const incidents = await sql('SELECT * FROM authority_v1.operational_incidents WHERE incident_key=$1', [context.operation_id]);
    if (!incidents[0]) return;
    const old = rows('AdminAlert').find(row => row.incident_key === context.operation_id);
    const fields = { incident_key: context.operation_id, description: incidents[0].description, resolved: false };
    if (old) await deps.entities.AdminAlert.update(old.id, fields);
    else await deps.entities.AdminAlert.create(fields);
  };
  deps.projectRelease = async context => {
    const snapshot = context.snapshot;
    const listing = rows('Listing').find(row => row.id === context.listing_id);
    const lp = rows('ListingPrivate').find(row => row.listing_id === context.listing_id);
    const revision = context.operation_id;
    const cleared = row => row.reservation_token === null && row.reserved_by_email === null && row.reservation_revision === revision;
    // Synthetic ordered projector: interruption can resume from old/cleared
    // snapshots. No public success before all required writes are re-read.
    const verify = async () => {
      const state = await deps.paymentAuthority.context(context.purchase_id);
      if (state.context.phase !== 'committed') throw new Error('PROJECTION_FENCED');
      const pending = rows('Purchase').filter(row => row.listing_id === context.listing_id && row.transfer_status === 'pending_transfer');
      if (pending.some(row => row.id !== context.purchase_id) || pending.some(row => row.seller_confirmed)) throw new Error('FULFILLMENT_CHANGED');
    };
    await verify();
    if (!cleared(listing) || !cleared(lp)) {
      // Already-cleared halves are acknowledged; never restore the old tuple.
      if (cleared(lp) && !cleared(listing)) {
        for (const field of ['reservation_token','reserved_by_email','reservation_expires_at','reservation_revision']) {
          if (listing[field] !== snapshot[field]) throw new Error('PROJECTION_OWNERSHIP_CHANGED');
        }
        await deps.entities.Listing.update(listing.id, { status: 'active', reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: revision });
      } else {
        const hooks = { ...deps.hooks };
        for (const name of ['beforeFirstTupleWrite','beforeListingUpdate']) hooks[name] = async (...args) => { await deps.hooks?.[name]?.(...args); await verify(); };
        const result = await applyReservationTuple({ ...deps, hooks }, listing.id,
          { status:'active',token:null,buyer:null,expiration:null,revision,hidden_reason:null },'release','m1-project',
          Object.fromEntries(['reservation_token','reserved_by_email','reservation_expires_at','reservation_revision'].map(key=>[key,snapshot[key]])), snapshot.listing_status);
        if (!result.ok) throw new Error('PROJECTION_OWNERSHIP_CHANGED');
      }
    }
    await deps.entities.Purchase.updateMany({ id:context.purchase_id },{ transfer_status:'expired' });
    await deps.entities.PurchasePrivate.updateMany({ id:snapshot.purchase_private_id },{ cleanup_completed_at:context.committed_at,cleanup_claim:null });
    await deps.entities.ListingPrivate.update(lp.id,{ recovery_blocked:false,checkout_quarantined:false,cleanup_purchase_id:null });
    const purchase = (await deps.entities.Purchase.filter({ id:context.purchase_id }))[0];
    const pp = (await deps.entities.PurchasePrivate.filter({ id:snapshot.purchase_private_id }))[0];
    if (purchase.transfer_status !== 'expired' || !pp.cleanup_completed_at) throw new Error('PROJECTION_PERSISTENCE_UNVERIFIED');
    return { verified:true,operation_id:context.operation_id,version:context.authority_version };
  };
  deps.projectReservationRelease = async (listing, context) => {
    const revision = `cleared_release_${crypto.randomUUID()}`;
    const result = await applyReservationTuple(deps,listing.id,{status:'active',token:null,buyer:null,expiration:null,revision,hidden_reason:null},'release','m1-unpaid');
    return {verified:result.ok,operation_id:context.operation_id,version:context.authority_version};
  };
  return deps;
}
