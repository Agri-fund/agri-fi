const { execSync } = require('child_process');

try {
  console.log('Running transaction-chunker tests...\n');
  const output = execSync('npx jest src/stellar/utils/transaction-chunker.spec.ts --verbose --no-coverage', {
    cwd: 'C:\\Users\\DELL\\Desktop\\agri-fi\\backend',
    encoding: 'utf8',
    stdio: 'pipe'
  });
  console.log(output);
} catch (error) {
  console.error('Test execution failed:');
  console.error(error.stdout);
  console.error(error.stderr);
  process.exit(1);
}