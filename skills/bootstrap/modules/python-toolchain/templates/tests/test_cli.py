from {{python_package}} import cli


def test_main_greets_and_exits_cleanly(capsys):
    assert cli.main() == 0
    assert capsys.readouterr().out == {{greeting_js}} + "\n"
