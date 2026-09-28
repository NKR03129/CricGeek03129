#!/usr/bin/env node
import process from 'node:process';

const query = process.argv.slice(2).join(' ');

if (!query) {
  console.error('Usage: npm run query -- "What is RAG?"');
  process.exit(1);
}

async function run() {
  const response = await fetch('http://localhost:8000/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: query })
  });

  if (!response.ok) {
    console.error(`Request failed with status ${response.status}`);
    const text = await response.text();
    console.error(text);
    process.exit(1);
  }

  const payload = await response.json();
  console.log('Answer:\n', payload.answer);
  console.log('\nTop contexts:\n', payload.contexts.join('\n---\n'));
}

run();
