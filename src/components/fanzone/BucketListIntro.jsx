import { useId } from 'react';
import { ArrowRight, MapPin, Mic2, Plus, Star } from 'lucide-react';
import './bucket-list.css';

export default function BucketListIntro({ onAdd, compact = false }) {
  const titleId = useId();
  if (compact) return <button type="button" className="pg-bucket-prompt" onClick={onAdd}>
    <Star size={21} aria-hidden="true" />
    <span><strong>Who’s on your bucket list?</strong><small>Save artists, teams and venues for related posts and event alerts.</small></span>
    <ArrowRight size={18} aria-hidden="true" />
  </button>;

  return <section className="pg-bucket-intro" aria-labelledby={titleId}>
    <span className="pg-bucket-intro-mark" aria-hidden="true"><Star size={28} /></span>
    <p className="pg-bucket-eyebrow">Your next live moment</p>
    <h2 id={titleId}>Build your bucket list.</h2>
    <p className="pg-bucket-intro-description">Start with the names and places you love. Find related fan posts and set up in-app event alerts.</p>
    <div className="pg-bucket-benefits">
      <div><Mic2 size={19} aria-hidden="true" /><span><strong>Artists & teams</strong><small>Find your favorites nearby, with alerts for your chosen area.</small></span></div>
      <div><MapPin size={19} aria-hidden="true" /><span><strong>Venues</strong><small>Follow event updates at the places you want to experience.</small></span></div>
    </div>
    <button type="button" className="pg-bucket-primary" onClick={onAdd}><Plus size={18} aria-hidden="true" /> Add to my bucket list</button>
    <p className="pg-bucket-intro-footnote">Make it yours. Start with one favorite.</p>
  </section>;
}
