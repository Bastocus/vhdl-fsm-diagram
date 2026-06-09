-- Phase 1: deeply nested if/elsif/else.
-- Parser v0.2 reports only the innermost condition; Phase 1 emits the full AND-chain.
-- Condition text is sliced verbatim from the source, so `error = '0'` stays literal
-- (matching the parallel `cond = '0'` case in nested_if_in_case.vhd).
--
-- EXPECT idle -> running | enable = '1' and go = '1'
-- EXPECT running -> done | done = '1' and error = '0'
-- EXPECT done -> idle | (always)

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_nested_if is
end fsm_nested_if;

architecture rtl of fsm_nested_if is
  type state_t is (idle, running, done);
  signal state : state_t;
  signal enable, go, done, error : std_logic;
begin
  process
  begin
    case state is
      when idle =>
        if enable = '1' then
          if go = '1' then
            state <= running;
          end if;
        end if;
      when running =>
        if done = '1' then
          if error = '0' then
            state <= done;
          end if;
        end if;
      when done =>
        state <= idle;
    end case;
    wait;
  end process;
end rtl;
