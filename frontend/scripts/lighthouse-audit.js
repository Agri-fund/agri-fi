#!/usr/bin/env node

/**
 * Lighthouse PWA Audit Script
 * 
 * Runs a Lighthouse audit on the app and checks for PWA compliance.
 * Usage: node scripts/lighthouse-audit.js [url]
 */

const lighthouse = require('lighthouse');
const chromeLauncher = require('chrome-launcher');
const fs = require('fs');
const path = require('path');

const URL = process.argv[2] || 'http://localhost:3000';

async function runLighthouse() {
  console.log(`🔍 Running Lighthouse PWA audit on ${URL}...`);
  
  let chrome;
  try {
    chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] });
    
    const options = {
      logLevel: 'info',
      output: 'json',
      port: chrome.port,
    };

    const runnerResult = await lighthouse(URL, options);

    // Extract scores
    const { lhr } = runnerResult;
    const pwaScore = lhr.categories.pwa.score * 100;
    const performanceScore = lhr.categories.performance.score * 100;
    const accessibilityScore = lhr.categories.accessibility.score * 100;
    const bestPracticesScore = lhr.categories['best-practices'].score * 100;
    const seoScore = lhr.categories.seo.score * 100;

    console.log('\n📊 Lighthouse Scores:');
    console.log(`  PWA:             ${pwaScore.toFixed(0)}/100 ${pwaScore >= 90 ? '✓' : '✗'}`);
    console.log(`  Performance:     ${performanceScore.toFixed(0)}/100`);
    console.log(`  Accessibility:   ${accessibilityScore.toFixed(0)}/100`);
    console.log(`  Best Practices:  ${bestPracticesScore.toFixed(0)}/100`);
    console.log(`  SEO:             ${seoScore.toFixed(0)}/100`);

    // Check PWA requirements
    console.log('\n🔐 PWA Checklist:');
    const pwaAudits = lhr.categories.pwa.auditRefs;
    pwaAudits.forEach((audit) => {
      const auditResult = lhr.audits[audit.id];
      const status = auditResult.score === 1 ? '✓' : '✗';
      console.log(`  ${status} ${auditResult.title}`);
    });

    // Save full report
    const reportPath = path.join(__dirname, '../lighthouse-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(lhr, null, 2));
    console.log(`\n📄 Full report saved to: ${reportPath}`);

    // Exit with error if PWA score < 90
    if (pwaScore < 90) {
      console.error(`\n❌ PWA score is ${pwaScore.toFixed(0)}/100. Target: 90+`);
      process.exit(1);
    }

    console.log('\n✅ PWA score meets requirements!');
    process.exit(0);
  } catch (error) {
    console.error('Lighthouse audit failed:', error);
    process.exit(1);
  } finally {
    if (chrome) {
      await chrome.kill();
    }
  }
}

runLighthouse();
