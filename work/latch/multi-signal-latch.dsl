combinators:
  SIG_IN: pole medium-electric-pole
  RESET_IN: pole medium-electric-pole
  OUT: pole medium-electric-pole
  CAPTURE: decider
    conditions:
      "signal-R" G = 0
      AND anything R != 0
    outputs:
      every = input R
  HOLD: decider
    conditions:
      "signal-R" G = 0
      AND anything R != 0
    outputs:
      every = input R

wires:
  network Signals: red
    SIG_IN out -> CAPTURE in
  network Reset: green
    RESET_IN out -> CAPTURE in
    RESET_IN out -> HOLD in
  network Latch: red
    CAPTURE out -> HOLD in
    CAPTURE out -> OUT in
    HOLD out -> HOLD in
    HOLD out -> OUT in

tests:
  capture-multi-signal-and-hold:
    tick 0:
      apply signal "signal-A" = 5 to network Signals
      apply signal "signal-B" = 2 to network Signals
    tick 1:
      assert signal "signal-A" = 5 on network Latch
      assert signal "signal-B" = 2 on network Latch
    tick 3:
      assert signal "signal-A" = 5 on network Latch
      assert signal "signal-B" = 2 on network Latch

  reset-clears-and-stays-cleared-while-high:
    tick 0:
      apply signal "signal-A" = 9 to network Signals
    tick 1:
      assert signal "signal-A" = 9 on network Latch
      apply signal "signal-R" = 1 to network Reset
    tick 2:
      assert signal "signal-A" = 0 on network Latch
      apply signal "signal-R" = 1 to network Reset
    tick 3:
      assert signal "signal-A" = 0 on network Latch
      apply signal "signal-R" = 1 to network Reset

  relatch-after-reset-release:
    tick 0:
      apply signal "signal-A" = 4 to network Signals
    tick 1:
      apply signal "signal-R" = 1 to network Reset
    tick 2:
      assert signal "signal-A" = 0 on network Latch
    tick 3:
      apply signal "signal-C" = 6 to network Signals
    tick 4:
      assert signal "signal-C" = 6 on network Latch
      assert signal "signal-A" = 0 on network Latch

  no-data-no-output:
    tick 2:
      assert signal "signal-A" = 0 on network Latch
      assert signal "signal-B" = 0 on network Latch
      assert signal "signal-C" = 0 on network Latch

  known-bug-continuous-input-accumulates:
    tick 0:
      apply signal "signal-A" = 5 to network Signals
    tick 1:
      apply signal "signal-A" = 5 to network Signals
      assert signal "signal-A" = 5 on network Latch
    tick 2:
      apply signal "signal-A" = 5 to network Signals
      assert signal "signal-A" = 10 on network Latch
    tick 3:
      apply signal "signal-A" = 5 to network Signals
      assert signal "signal-A" = 15 on network Latch
    tick 4:
      assert signal "signal-A" = 20 on network Latch
