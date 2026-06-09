-- Phase 3: when with multiple labels (|).
-- Phase 3 will expand "when s1 | s2" to separate transitions from each state.
--
-- EXPECT s1 -> done | (always)
-- EXPECT s2 -> done | (always)
-- EXPECT s3 -> idle | (always)

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_when_multi is
end fsm_when_multi;

architecture rtl of fsm_when_multi is
  type state_t is (s1, s2, s3, done, idle);
  signal state : state_t;
begin
  process
  begin
    case state is
      when s1 | s2 =>
        state <= done;
      when s3 =>
        state <= idle;
      when done =>
        state <= idle;
      when idle =>
        state <= s1;
    end case;
    wait;
  end process;
end rtl;
