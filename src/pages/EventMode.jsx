/**
 * EventMode — deprecated route.
 * Redirects to /upgrades/:id which now hosts the full Live Hub experience.
 */
import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

export default function EventMode() {
  const { id } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    navigate(`/upgrades/${id}`, { replace: true });
  }, [id, navigate]);

  return null;
}