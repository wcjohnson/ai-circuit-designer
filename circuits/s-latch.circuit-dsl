combinators:
  DATA_IN: pole medium-electric-pole
  SET_IN: pole medium-electric-pole
  OUT: pole medium-electric-pole
  OUT_BUF: arithmetic
    expression: each R + 0 -> each
  CAPTURE: decider
    conditions:
      "signal-S" G != 0
      AND anything R != 0
    outputs:
      every = input R
  HOLD: decider
    conditions:
      "signal-S" G = 0
      AND anything R != 0
    outputs:
      every = input R

wires:
  network Data: red
    DATA_IN out -> CAPTURE in
  network Set: green
    SET_IN out -> CAPTURE in
    SET_IN out -> HOLD in
  network State: red
    CAPTURE out -> HOLD in
    CAPTURE out -> OUT_BUF in
    HOLD out -> HOLD in
    HOLD out -> OUT_BUF in
  network PublicOut: red
    OUT_BUF out -> OUT in

tests:
  captures-while-set-high:
    tick 0:
      apply signal "signal-S" = 1 to network Set
      apply signal "signal-A" = 3 to network Data
    tick 1:
      assert signal "signal-A" = 3 on network State
      apply signal "signal-S" = 1 to network Set
      apply signal "signal-A" = 7 to network Data
    tick 2:
      assert signal "signal-A" = 7 on network State

  holds-when-set-low:
    tick 0:
      apply signal "signal-S" = 1 to network Set
      apply signal "signal-A" = 4 to network Data
    tick 1:
      assert signal "signal-A" = 4 on network State
    tick 2:
      assert signal "signal-A" = 4 on network State
    tick 3:
      assert signal "signal-A" = 4 on network State

  low-set-does-not-capture-new-input:
    tick 0:
      apply signal "signal-S" = 1 to network Set
      apply signal "signal-A" = 5 to network Data
    tick 1:
      assert signal "signal-A" = 5 on network State
      apply signal "signal-C" = 9 to network Data
    tick 2:
      assert signal "signal-A" = 5 on network State
      assert signal "signal-C" = 0 on network State
    tick 3:
      assert signal "signal-A" = 5 on network State
      assert signal "signal-C" = 0 on network State

  relatches-when-set-goes-high-again:
    tick 0:
      apply signal "signal-S" = 1 to network Set
      apply signal "signal-A" = 2 to network Data
    tick 1:
      assert signal "signal-A" = 2 on network State
    tick 2:
      apply signal "signal-S" = 1 to network Set
      apply signal "signal-B" = 6 to network Data
    tick 3:
      assert signal "signal-B" = 6 on network State
      assert signal "signal-A" = 0 on network State

  single-frame-set-pulse-captures-and-holds:
    tick 0:
      apply signal "signal-S" = 1 to network Set
      apply signal "signal-A" = 8 to network Data
    tick 1:
      assert signal "signal-A" = 8 on network State
      apply signal "signal-A" = 1 to network Data
    tick 2:
      assert signal "signal-A" = 8 on network State

  set-control-signal-not-on-output:
    tick 0:
      apply signal "signal-S" = 1 to network Set
      apply signal "signal-A" = 3 to network Data
    tick 1:
      assert signal "signal-S" = 0 on network State
    tick 2:
      assert signal "signal-S" = 0 on network State

  output-pollution-does-not-corrupt-state:
    tick 0:
      apply signal "signal-S" = 1 to network Set
      apply signal "signal-A" = 4 to network Data
    tick 1:
      assert signal "signal-A" = 4 on network State
      apply signal "signal-X" = 99 to network PublicOut
    tick 2:
      assert signal "signal-A" = 4 on network State
      assert signal "signal-X" = 0 on network State

  no-set-no-output:
    tick 0:
      apply signal "signal-A" = 5 to network Data
    tick 1:
      assert signal "signal-A" = 0 on network State
    tick 2:
      assert signal "signal-A" = 0 on network State
