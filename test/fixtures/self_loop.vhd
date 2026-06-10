-- Issue #3: Self-loop transitions (state to itself) clutter the diagram.
-- These should not be displayed. Example: idle with "if not a then stay in idle"
-- should not render as an arrow from idle back to itself.
--
-- EXPECT idle -> running | a = '1'
-- EXPECT running -> done | b = '1'
-- EXPECT done -> idle | c = '1'

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_self_loop is
end fsm_self_loop;

architecture rtl of fsm_self_loop is
  type state_t is (idle, running, done);
  signal state : state_t;
  signal a, b, c : std_logic;
begin
  process
  begin
    case state is
      when idle =>
        if a = '1' then
          state <= running;
        else
          state <= idle;  -- self-loop, should not be displayed
        end if;
      when running =>
        if b = '1' then
          state <= done;
        else
          state <= running;  -- self-loop, should not be displayed
        end if;
      when done =>
        if c = '1' then
          state <= idle;
        else
          state <= done;  -- self-loop, should not be displayed
        end if;
    end case;
    wait;
  end process;
end rtl;
