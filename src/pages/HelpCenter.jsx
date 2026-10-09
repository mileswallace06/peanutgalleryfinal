import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ArrowRight, Mail, Ticket, Sparkles, Store, UserRound, Bookmark } from 'lucide-react';
import PublicPage from '@/components/PublicPage';
import { PageIntro } from '@/components/ClarityUI';
import './help-center.css';
import { helpQuerySummary } from '@/lib/helpQuerySummary';

const TOPICS = [
  { id: 'tickets', title: 'Tickets & orders', icon: Ticket, items: [
    { q: 'Where are my tickets?', a: 'Open Me, then My tickets. Select an order to see its current status and next steps. An upgrade is listed here too, but it does not replace your event admission ticket.', to: '/my-tickets', label: 'Open My tickets' },
    { q: 'How do I receive a ticket I bought?', a: 'Open the order in My tickets and follow its transfer instructions. Check the receiving email address and your original ticket-provider account. Only confirm receipt after you can access the correct ticket.', to: '/my-tickets', label: 'View my orders' },
    { q: 'Something is wrong with my order. What should I do?', a: 'Open that order first to review its status and the actions available. If you still need help, email support with the order reference and a description of the problem. Do not send passwords, payment-card details or a scannable ticket barcode.' },
    { q: 'Why did a listing disappear?', a: 'A listing may be reserved, sold, removed, or past its event. A shared image is a snapshot; open the listing link to check its current availability.', to: '/events', label: 'Browse events' },
  ] },
  { id: 'upgrades', title: 'Seat upgrades', icon: Sparkles, items: [
    { q: 'Does an upgrade include admission?', a: 'No. An upgrade is an additional purchase for someone who already has valid admission to the same event. Keep your original admission ticket and check the upgrade details before buying.', to: '/upgrades', label: 'Explore upgrades' },
    { q: 'Why are there no upgrades for my event?', a: 'An event can be underway without anyone offering an upgrade. Open its upgrade page to check the start time and current availability. Where supported, you can save an in-app upgrade alert there. The page tells you if alert delivery is not active yet. Availability depends on listings for that specific event.' },
    { q: 'How do I find upgrades for tickets I already own?', a: 'Go to My tickets and open the relevant event or use its Upgrade action when available. You can also find the event on the Upgrades tab.', to: '/my-tickets', label: 'Find my tickets' },
  ] },
  { id: 'selling', title: 'Selling & sharing', icon: Store, items: [
    { q: 'How do I list a ticket?', a: 'Open Sell and choose List Tickets. Select the event, then follow the steps for your ticket type, seat details, price and required evidence. Finish any seller setup shown before submitting.', to: '/sell', label: 'Open Sell' },
    { q: 'Where do I manage my listings?', a: 'My Sales shows your active listings, actions that need attention and completed sales. Open a listing or sale there to see the available next steps.', to: '/my-sales', label: 'Open My Sales' },
    { q: 'How do I share a listing?', a: 'In My Sales, choose Share listing on an eligible active listing. Pick a square post or Story image, then save it, copy the link or use your device’s supported sharing menu. The image includes a QR code for the listing and is not an admission ticket.', to: '/my-sales', label: 'Share from My Sales' },
    { q: 'Where can I check my payout setup?', a: 'Open Account Settings, then Payouts & transactions. Follow the setup or account-management action shown there. Check the order and your payout provider for the current status; support can help if you are unsure.', to: '/account-settings', label: 'Open Account Settings' },
  ] },
  { id: 'bucket', title: 'Bucket list & Fan Zone', icon: Bookmark, items: [
    { q: 'What should I add to my bucket list?', a: 'Save the artists, bands, teams and venues you want to keep up with. Open the Bucket List tab in Fan Zone to build or edit your list and find related posts.', to: '/fan-zone?tab=bucket_list&bucket=edit', label: 'Build my bucket list' },
    { q: 'How do Bucket List alerts work?', a: 'Open your Bucket List and choose Alerts. Save a city area and radius for artists and teams; saved venues follow events at that venue. Alerts appear in your in-app Notifications inbox when the alert service is active and Peanut Gallery discovers a matching event. The settings screen shows if delivery is not active yet.', to: '/fan-zone?tab=bucket_list&bucket=edit', label: 'Manage my bucket list' },
    { q: 'How do I post in Fan Zone?', a: 'Tap Create in Fan Zone, choose what you want to share, and follow the composer. Add the relevant event when applicable so other fans can find your post.', to: '/fan-zone', label: 'Open Fan Zone' },
  ] },
  { id: 'account', title: 'Account & app settings', icon: UserRound, items: [
    { q: 'How do I change the app’s appearance?', a: 'Open Me, then Account Settings. Use the Dark Mode switch in Appearance to choose the look you prefer.', to: '/account-settings', label: 'Open Account Settings' },
    { q: 'How do I reset my password?', a: 'Use Forgot password on the PG sign-in screen and follow the email instructions. If you normally sign in with Google or Apple, use that same sign-in method.', to: '/forgot-password', label: 'Reset my password' },
    { q: 'How do I change the city I browse?', a: 'On Events, tap the city control to choose an area. You can browse with a chosen city without granting access to your device’s precise location.', to: '/events', label: 'Choose a city' },
  ] },
];

export default function HelpCenter() {
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('all');
  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return TOPICS.filter(group => topic === 'all' || group.id === topic)
      .map(group => ({ ...group, items: group.items.filter(item => !needle || `${group.title} ${item.q} ${item.a}`.toLocaleLowerCase().includes(needle)) }))
      .filter(group => group.items.length);
  }, [query, topic]);
  const resultCount = results.reduce((count, group) => count + group.items.length, 0);

  return (
    <PublicPage as="main" className="pg-help-page">
      <div className="pg-secondary-page pg-help-inner">
        <PageIntro eyebrow="The fan desk" title="Help Center" description="Clear answers. Your next step." backTo="/me" backLabel="Back to Me" />
        <div className="pg-help-search">
          <Search size={20} aria-hidden="true" />
          <label className="sr-only" htmlFor="help-search">Search help</label>
          <input id="help-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Try tickets, sharing or password" />
        </div>
        <label className="pg-help-topic" htmlFor="help-topic">Browse a topic
          <select id="help-topic" value={topic} onChange={e => setTopic(e.target.value)}>
            <option value="all">All topics</option>
            {TOPICS.map(group => <option key={group.id} value={group.id}>{group.title}</option>)}
          </select>
        </label>
        <p className="pg-help-count" role="status">{resultCount} {resultCount === 1 ? 'answer' : 'answers'}{query.trim() ? ` for “${helpQuerySummary(query)}”` : ' to get you moving'}</p>
        <div className="pg-help-results">
          {results.map(({ id, title, icon: Icon, items }) => (
            <section key={id} aria-labelledby={`help-${id}`}>
              <h2 id={`help-${id}`}><Icon size={20} aria-hidden="true" />{title}</h2>
              {items.map(item => <details key={item.q} className="pg-help-answer">
                <summary>{item.q}<span aria-hidden="true">+</span></summary>
                <div><p>{item.a}</p>{item.to && <Link to={item.to}>{item.label}<ArrowRight size={16} aria-hidden="true" /></Link>}</div>
              </details>)}
            </section>
          ))}
          {!resultCount && <div className="pg-state"><h2>No matching answers yet</h2><p>Try another search or ask us directly below.</p><button className="pg-action" type="button" onClick={() => { setQuery(''); setTopic('all'); }}>Show all topics</button></div>}
        </div>
        <section className="pg-help-contact" aria-labelledby="help-contact">
          <Mail size={23} aria-hidden="true" />
          <div><h2 id="help-contact">Still need a hand?</h2><p>Tell us what happened and include the order or listing reference if you have one.</p>
            <a className="pg-action" href="mailto:experience@peanutgallery.store?subject=Peanut%20Gallery%20support">Email support<ArrowRight size={17} aria-hidden="true" /></a>
            <small>Opens your email app. experience@peanutgallery.store</small>
          </div>
        </section>
        <footer className="pg-help-footer"><Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link><Link to="/">Peanut Gallery home</Link></footer>
      </div>
    </PublicPage>
  );
}
