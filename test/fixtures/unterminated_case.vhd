-- Phase 3: an unterminated `case` statement (no matching `end case`) must
-- surface a diagnostic in result.errors rather than silently yielding nothing.
--
-- EXPECT_ERROR Unterminated 'case'

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_unterminated is
end fsm_unterminated;

architecture rtl of fsm_unterminated is
  type state_t is (idle, active);
  signal s : state_t;
begin
  process
  begin
    case s is
      when idle => s <= active;
      -- file ends here without end case / end process / end architecture
