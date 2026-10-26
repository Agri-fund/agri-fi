import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CopyTradingControls } from '../CopyTradingControls';
import { useCopyTrading } from '@/hooks/useCopyTrading';
import { DEMO_FOLLOWER_ID } from '@/lib/social-trading/sample-data';

function Harness() {
  const copy = useCopyTrading({
    viewerId: DEMO_FOLLOWER_ID,
    isTraderFollowing: () => true,
  });
  return (
    <CopyTradingControls
      config={copy.config}
      fieldErrors={copy.fieldErrors}
      dryRun={copy.dryRun}
      onChangeConfig={copy.updateConfig}
      onSave={copy.saveConfig}
      onSubmitOrders={copy.submitOrders}
      remainingAllowanceUsd={copy.remainingAllowanceUsd}
      followingTrader={copy.followingTrader}
      autoStop={copy.autoStop}
      onResumeCopying={copy.resumeCopying}
    />
  );
}

describe('CopyTradingControls', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders a live dry run for the default valid configuration', () => {
    render(<Harness />);

    const summary = screen.getByTestId('dry-run-summary');
    expect(summary).toBeInTheDocument();
    expect(summary).toHaveTextContent('Deployed');
    expect(summary).toHaveTextContent('Estimated fees');

    // Amina's September/October trades: two proportional tickets clear the
    // 150 USD minimum, the third is rejected as BELOW_MINIMUM.
    expect(screen.getAllByTestId('planned-order')).toHaveLength(2);
    expect(screen.getByTestId('copy-rejection')).toHaveTextContent('BELOW_MINIMUM');
  });

  it('surfaces a validation error and plans no orders when maxPerTrade exceeds monthlyLimit', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.clear(screen.getByLabelText('Maximum per trade (USD)'));
    await user.type(screen.getByLabelText('Maximum per trade (USD)'), '20000');

    expect(
      screen.getByText('Monthly limit cannot be lower than the per-trade cap.'),
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId('planned-order')).toHaveLength(0);
    expect(screen.getByTestId('dry-run-summary')).toHaveTextContent('$0');
    expect(
      screen.getByText('No orders are planned while the configuration has validation errors.'),
    ).toBeInTheDocument();
  });
});
