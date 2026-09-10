import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import Events from '../../../src/pages/Events';
import '../../../src/index.css';

createRoot(document.getElementById('root')).render(<MemoryRouter><Events /></MemoryRouter>);
